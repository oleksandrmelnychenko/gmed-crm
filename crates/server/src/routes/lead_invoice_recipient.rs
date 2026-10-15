//! Step 3 of the lead cabinet, "Versicherung & Rechnung" (owner spec
//! 2026-10-11): the invoice recipient comes first and absorbs "who pays".
//!
//! 1. "Wer ist Rechnungsempfänger?" — the patient side (`self`; for a minor
//!    the parents as contracting party) or a third party (`third_party`).
//! 2. A third party is a person or an organisation (`recipient_type`), with
//!    its data: a person's name, address, contact and relationship to the
//!    patient; an organisation's name, legal form, seat, contact person and
//!    why the invoice goes through it.
//! 3. "Der Rechnungsempfänger ist auch der Zahler" (`recipient_is_payer`), a
//!    checkbox ticked by default (owner 2026-10-11): choosing a recipient
//!    stores `true` unless the body says `false`.
//! 4. Only when unticked: the payer. A third-party recipient: "Zahler ist
//!    die Patientin / der Patient" (for a parent's login the paying parent)
//!    or "Zahler ist eine andere Person oder Organisation" with its data; the
//!    patient side as recipient: only another person or organisation.
//!
//! The answers live in `lead_invoice_recipients`; the payer stays the payer
//! declaration (`lead_payer_declarations`), which the risk triggers, the payer
//! link, the payer package and the GwG sheets read. Section 7 of the
//! declaration (`invoice_to` and the other address) is derived from the
//! answers ([`sync_section_seven`]): `self`, `payer` for a third party who
//! pays, `other` with the recipient's name and address for a third party who
//! does not. A request without a row (sent before 2026-10-11) keeps its
//! section 7; the answers are derived from it ([`derived`]).

use serde_json::{Map, Value, json};
use sqlx::{PgConnection, Row, postgres::PgRow};
use uuid::Uuid;

use crate::audit;
use crate::routes::invoices::payer::is_plausible_email;
use crate::routes::lead_payer::{
    self, Declaration, INVOICE_TO_OTHER, INVOICE_TO_PAYER, INVOICE_TO_SELF, RELATIONSHIP_KINDS,
};
use crate::routes::lead_portal_intake::{
    FieldError, clean_long_text, clean_phone, clean_text, field_error,
};
use crate::services::citizenships::normalize_country_code;

pub(crate) const RECIPIENT_SELF: &str = "self";
pub(crate) const RECIPIENT_THIRD_PARTY: &str = "third_party";
pub(crate) const RECIPIENT_TYPE_PERSON: &str = "person";
pub(crate) const RECIPIENT_TYPE_ORGANISATION: &str = "organisation";

const RELATIONSHIP_KIND_OTHER: &str = "other";

/// The keys of `POST /me/lead-requests/{id}/billing` that belong to the
/// recipient (taken out of the body before section 7 and 8 are read).
pub(crate) const RECIPIENT_KEYS: [&str; 18] = [
    "invoice_recipient",
    "invoice_recipient_is_payer",
    "recipient_representative_id",
    "recipient_type",
    "recipient_first_name",
    "recipient_last_name",
    "recipient_organisation_name",
    "recipient_legal_form",
    "recipient_contact_name",
    "recipient_street",
    "recipient_zip",
    "recipient_city",
    "recipient_country",
    "recipient_email",
    "recipient_phone",
    "recipient_relationship_kind",
    "recipient_relationship",
    "recipient_payment_reason",
];

/// The answers of step 3 about the invoice recipient.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct Recipient {
    pub(crate) representative_contact_id: Option<Uuid>,
    // Resolved from the child's current parent, never accepted from the body.
    pub(crate) parent_email: Option<String>,
    pub(crate) parent_date_of_birth: Option<chrono::NaiveDate>,
    /// [`RECIPIENT_SELF`] or [`RECIPIENT_THIRD_PARTY`]; `None` until answered.
    pub(crate) recipient: Option<String>,
    /// "Der Rechnungsempfänger ist auch der Zahler" (a checkbox, `true` by
    /// default once a recipient is chosen).
    pub(crate) is_payer: Option<bool>,
    /// A third party: [`RECIPIENT_TYPE_PERSON`] or [`RECIPIENT_TYPE_ORGANISATION`].
    pub(crate) recipient_type: Option<String>,
    pub(crate) first_name: Option<String>,
    pub(crate) last_name: Option<String>,
    pub(crate) organisation_name: Option<String>,
    pub(crate) legal_form: Option<String>,
    pub(crate) contact_name: Option<String>,
    pub(crate) street: Option<String>,
    pub(crate) zip: Option<String>,
    pub(crate) city: Option<String>,
    pub(crate) country: Option<String>,
    /// The e-mail for invoices (the patient side's or the recipient's).
    pub(crate) email: Option<String>,
    pub(crate) phone: Option<String>,
    pub(crate) relationship_kind: Option<String>,
    pub(crate) relationship: Option<String>,
    /// Why the invoice goes through an organisation that does not pay.
    pub(crate) payment_reason: Option<String>,
    /// The name of section 7 of a request sent before the recipient flow
    /// (`invoice_name`, "another address"): shown, never stored here.
    pub(crate) legacy_name: Option<String>,
}

impl Recipient {
    fn from_row(row: &PgRow) -> Self {
        let text = |column: &str| row.try_get::<Option<String>, _>(column).ok().flatten();
        Self {
            representative_contact_id: row.try_get("representative_contact_id").ok().flatten(),
            recipient: text("recipient"),
            is_payer: row.try_get("recipient_is_payer").ok().flatten(),
            recipient_type: text("recipient_type"),
            first_name: text("first_name"),
            last_name: text("last_name"),
            organisation_name: text("organisation_name"),
            legal_form: text("legal_form"),
            contact_name: text("contact_name"),
            street: text("street"),
            zip: text("zip"),
            city: text("city"),
            country: text("country"),
            email: text("email"),
            phone: text("phone"),
            relationship_kind: text("relationship_kind"),
            relationship: text("relationship"),
            payment_reason: text("payment_reason"),
            legacy_name: None,
            ..Self::default()
        }
    }

    pub(crate) fn is_third_party(&self) -> bool {
        self.recipient.as_deref() == Some(RECIPIENT_THIRD_PARTY)
    }

    pub(crate) fn is_organisation(&self) -> bool {
        self.is_third_party() && self.recipient_type.as_deref() == Some(RECIPIENT_TYPE_ORGANISATION)
    }

    /// The recipient's name: the organisation's, "First Last" of a person, or
    /// the name section 7 of an older request holds.
    pub(crate) fn name(&self) -> Option<String> {
        if !self.is_third_party() && self.representative_contact_id.is_none() {
            return None;
        }
        let name = if self.is_organisation() {
            self.organisation_name.clone().unwrap_or_default()
        } else {
            [self.first_name.as_deref(), self.last_name.as_deref()]
                .into_iter()
                .flatten()
                .map(str::trim)
                .filter(|part| !part.is_empty())
                .collect::<Vec<_>>()
                .join(" ")
        };
        Some(name)
            .filter(|name| !name.trim().is_empty())
            .or_else(|| self.legacy_name.clone())
    }

    /// The data of a third-party recipient (`recipient` of the request object
    /// and of the staff view).
    fn party_json(&self) -> Value {
        let mut party = json!({
            "type": self.recipient_type,
            "name": self.name(),
            "first_name": self.first_name,
            "last_name": self.last_name,
            "organisation_name": self.organisation_name,
            "legal_form": self.legal_form,
            "contact_name": self.contact_name,
            "street": self.street,
            "zip": self.zip,
            "city": self.city,
            "country": self.country,
            "email": self.email.as_ref().or(self.parent_email.as_ref()),
            "phone": self.phone,
            "relationship_kind": self.relationship_kind,
            "relationship": self.relationship,
            "payment_reason": self.payment_reason,
        });
        if let Some(id) = self.representative_contact_id {
            party["representative_id"] = json!(id);
        }
        party
    }

    /// The keys the cabinet's `billing` gets: the two answers and the
    /// recipient's data.
    pub(crate) fn portal_json(&self) -> Value {
        json!({
            "invoice_recipient": self.recipient,
            "invoice_recipient_is_payer": self.is_payer,
            "recipient": self.party_json(),
        })
    }

    /// Stable text of the answers, for the "entered by the patient" marker.
    pub(crate) fn marker_value(&self) -> String {
        self.portal_json().to_string()
    }
}

/// The stored answers of a lead; `None` before the lead answered any.
pub(crate) async fn load(
    conn: &mut PgConnection,
    lead_id: Uuid,
) -> Result<Option<Recipient>, sqlx::Error> {
    Ok(
        sqlx::query("SELECT * FROM lead_invoice_recipients WHERE lead_id = $1")
            .bind(lead_id)
            .fetch_optional(conn)
            .await?
            .as_ref()
            .map(Recipient::from_row),
    )
}

/// The answers of a request sent before the recipient flow, read from its
/// section 7: `self` (the recipient pays unless a third party other than
/// the paying parent does), `payer` (a third party who pays) or `other` (a
/// third party at another address who does not pay).
pub(crate) fn derived(declaration: Option<&Declaration>, paying_parent: bool) -> Recipient {
    let Some(declaration) = declaration else {
        return Recipient::default();
    };
    match declaration.invoice_to.as_deref() {
        Some(INVOICE_TO_SELF) => Recipient {
            recipient: Some(RECIPIENT_SELF.into()),
            is_payer: Some(!declaration.is_third_party() || paying_parent),
            email: declaration.invoice_email.clone(),
            ..Recipient::default()
        },
        Some(INVOICE_TO_PAYER) => {
            let organisation = declaration.is_organisation();
            Recipient {
                recipient: Some(RECIPIENT_THIRD_PARTY.into()),
                is_payer: Some(true),
                recipient_type: Some(
                    if organisation {
                        RECIPIENT_TYPE_ORGANISATION
                    } else {
                        RECIPIENT_TYPE_PERSON
                    }
                    .into(),
                ),
                first_name: declaration.first_name.clone().filter(|_| !organisation),
                last_name: declaration.last_name.clone().filter(|_| !organisation),
                organisation_name: declaration
                    .organisation_name
                    .clone()
                    .filter(|_| organisation),
                street: declaration.street.clone(),
                zip: declaration.zip.clone(),
                city: declaration.city.clone(),
                country: declaration.country.clone(),
                email: declaration.email.clone(),
                phone: declaration.phone.clone(),
                relationship_kind: declaration
                    .relationship_kind
                    .clone()
                    .filter(|_| !organisation),
                relationship: declaration.relationship.clone().filter(|_| !organisation),
                ..Recipient::default()
            }
        }
        Some(INVOICE_TO_OTHER) => Recipient {
            recipient: Some(RECIPIENT_THIRD_PARTY.into()),
            is_payer: Some(false),
            street: declaration.invoice_street.clone(),
            zip: declaration.invoice_zip.clone(),
            city: declaration.invoice_city.clone(),
            country: declaration.invoice_country.clone(),
            email: declaration.invoice_email.clone(),
            legacy_name: declaration.invoice_name.clone(),
            ..Recipient::default()
        },
        _ => Recipient::default(),
    }
}

/// The answers that count: the stored row, or those of section 7.
pub(crate) fn effective(
    stored: Option<&Recipient>,
    declaration: Option<&Declaration>,
    paying_parent: bool,
) -> Recipient {
    stored
        .cloned()
        .unwrap_or_else(|| derived(declaration, paying_parent))
}

fn text_value(value: &Value, field: &'static str) -> Result<String, FieldError> {
    match value {
        Value::Null => Ok(String::new()),
        Value::String(text) => Ok(text.clone()),
        _ => Err(field_error(field, "A text is expected")),
    }
}

fn choice(
    value: &Value,
    field: &'static str,
    allowed: &[&str],
) -> Result<Option<String>, FieldError> {
    let text = text_value(value, field)?;
    let text = text.trim();
    if text.is_empty() {
        Ok(None)
    } else if allowed.contains(&text) {
        Ok(Some(text.to_string()))
    } else {
        Err(field_error(field, "Not one of the allowed values"))
    }
}

/// Applies the sent keys of the body to `current` (only those; `null` or
/// `""` clears) and clears what no longer belongs to the answers: the party
/// with the patient side as recipient, the other type's data, the words of a
/// relationship other than `other`, the reason of an organisation that pays
/// (the payer's reason is `payment_background`), and the e-mail of the
/// recipient answered before.
pub(crate) fn apply(
    current: &Recipient,
    body: &Map<String, Value>,
) -> Result<Recipient, FieldError> {
    let mut next = current.clone();
    next.legacy_name = None;
    for (key, value) in body {
        match key.as_str() {
            "invoice_recipient" => {
                next.recipient = choice(
                    value,
                    "invoice_recipient",
                    &[RECIPIENT_SELF, RECIPIENT_THIRD_PARTY],
                )?;
            }
            "invoice_recipient_is_payer" => {
                next.is_payer = match value {
                    Value::Null => None,
                    Value::Bool(answer) => Some(*answer),
                    _ => {
                        return Err(field_error(
                            "invoice_recipient_is_payer",
                            "true, false or null is expected",
                        ));
                    }
                };
            }
            "recipient_representative_id" => {
                let text = text_value(value, "recipient_representative_id")?;
                next.representative_contact_id = if text.trim().is_empty() {
                    None
                } else {
                    Some(Uuid::parse_str(text.trim()).map_err(|_| {
                        field_error(
                            "recipient_representative_id",
                            "A representative id is expected",
                        )
                    })?)
                };
            }
            "recipient_type" => {
                next.recipient_type = choice(
                    value,
                    "recipient_type",
                    &[RECIPIENT_TYPE_PERSON, RECIPIENT_TYPE_ORGANISATION],
                )?;
            }
            "recipient_first_name" => {
                next.first_name = clean_text(
                    &text_value(value, "recipient_first_name")?,
                    "recipient_first_name",
                    100,
                )?;
            }
            "recipient_last_name" => {
                next.last_name = clean_text(
                    &text_value(value, "recipient_last_name")?,
                    "recipient_last_name",
                    100,
                )?;
            }
            "recipient_organisation_name" => {
                next.organisation_name = clean_text(
                    &text_value(value, "recipient_organisation_name")?,
                    "recipient_organisation_name",
                    200,
                )?;
            }
            "recipient_legal_form" => {
                next.legal_form = clean_text(
                    &text_value(value, "recipient_legal_form")?,
                    "recipient_legal_form",
                    100,
                )?;
            }
            "recipient_contact_name" => {
                next.contact_name = clean_text(
                    &text_value(value, "recipient_contact_name")?,
                    "recipient_contact_name",
                    200,
                )?;
            }
            "recipient_street" => {
                next.street = clean_text(
                    &text_value(value, "recipient_street")?,
                    "recipient_street",
                    200,
                )?;
            }
            "recipient_zip" => {
                next.zip = clean_text(&text_value(value, "recipient_zip")?, "recipient_zip", 20)?;
            }
            "recipient_city" => {
                next.city =
                    clean_text(&text_value(value, "recipient_city")?, "recipient_city", 200)?;
            }
            "recipient_country" => {
                let text = text_value(value, "recipient_country")?;
                next.country = normalize_country_code(Some(text.as_str()))
                    .map_err(|_| field_error("recipient_country", "Use an ISO country code"))?;
            }
            "recipient_email" => {
                let email = clean_text(
                    &text_value(value, "recipient_email")?,
                    "recipient_email",
                    254,
                )?;
                if email
                    .as_deref()
                    .is_some_and(|email| !is_plausible_email(email))
                {
                    return Err(field_error("recipient_email", "Invalid e-mail address"));
                }
                next.email = email;
            }
            "recipient_phone" => {
                next.phone =
                    clean_phone(&text_value(value, "recipient_phone")?, "recipient_phone")?;
            }
            "recipient_relationship_kind" => {
                next.relationship_kind =
                    choice(value, "recipient_relationship_kind", RELATIONSHIP_KINDS)?;
            }
            "recipient_relationship" => {
                next.relationship = clean_text(
                    &text_value(value, "recipient_relationship")?,
                    "recipient_relationship",
                    200,
                )?;
            }
            "recipient_payment_reason" => {
                next.payment_reason = clean_long_text(
                    &text_value(value, "recipient_payment_reason")?,
                    "recipient_payment_reason",
                    2000,
                )?;
            }
            _ => return Err(field_error("body", "Unknown field")),
        }
    }
    // Another recipient: the e-mail named for the one before goes, unless
    // the body names one.
    if (next.recipient != current.recipient
        || next.representative_contact_id != current.representative_contact_id)
        && !body.contains_key("recipient_email")
    {
        next.email = None;
    }
    // "Der Rechnungsempfänger ist auch der Zahler" is a checkbox, ticked as
    // soon as a recipient is chosen (owner 2026-10-11): a recipient without
    // an answer pays, also when the body clears the answer.
    if next.recipient.is_none() {
        next.is_payer = None;
    } else if next.is_payer.is_none() {
        next.is_payer = Some(true);
    }
    if !next.is_third_party() {
        let email = next.email.take();
        next = Recipient {
            representative_contact_id: next.representative_contact_id,
            recipient: next.recipient,
            is_payer: next.is_payer,
            email,
            ..Recipient::default()
        };
    }
    if next.recipient.as_deref() != Some(RECIPIENT_SELF) {
        next.representative_contact_id = None;
    }
    match next.recipient_type.as_deref() {
        Some(RECIPIENT_TYPE_ORGANISATION) => {
            next.first_name = None;
            next.last_name = None;
            next.relationship_kind = None;
            next.relationship = None;
        }
        Some(_) => {
            next.organisation_name = None;
            next.legal_form = None;
            next.contact_name = None;
            next.payment_reason = None;
        }
        None => {}
    }
    if next.relationship_kind.as_deref() != Some(RELATIONSHIP_KIND_OTHER) {
        next.relationship = None;
    }
    if next.is_payer == Some(true) {
        next.payment_reason = None;
    }
    Ok(next)
}

/// The keys whose stored value differs (names only, for the audit event).
pub(crate) fn changed_keys(before: &Recipient, after: &Recipient) -> Vec<&'static str> {
    let (left, right) = (before.portal_json(), after.portal_json());
    let mut changed = Vec::new();
    if left["invoice_recipient"] != right["invoice_recipient"] {
        changed.push("invoice_recipient");
    }
    if left["invoice_recipient_is_payer"] != right["invoice_recipient_is_payer"] {
        changed.push("invoice_recipient_is_payer");
    }
    for (key, field) in [
        ("recipient_representative_id", "representative_id"),
        ("recipient_type", "type"),
        ("recipient_first_name", "first_name"),
        ("recipient_last_name", "last_name"),
        ("recipient_organisation_name", "organisation_name"),
        ("recipient_legal_form", "legal_form"),
        ("recipient_contact_name", "contact_name"),
        ("recipient_street", "street"),
        ("recipient_zip", "zip"),
        ("recipient_city", "city"),
        ("recipient_country", "country"),
        ("recipient_email", "email"),
        ("recipient_phone", "phone"),
        ("recipient_relationship_kind", "relationship_kind"),
        ("recipient_relationship", "relationship"),
        ("recipient_payment_reason", "payment_reason"),
    ] {
        if left["recipient"][field] != right["recipient"][field] {
            changed.push(key);
        }
    }
    changed
}

/// Stores the answers (insert or update) in the caller's transaction.
pub(crate) async fn store(
    conn: &mut PgConnection,
    lead_id: Uuid,
    recipient: &Recipient,
    actor: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"INSERT INTO lead_invoice_recipients (
               lead_id, recipient, recipient_is_payer, recipient_type, first_name, last_name,
               organisation_name, legal_form, contact_name, street, zip, city, country, email,
               phone, relationship_kind, relationship, payment_reason, updated_by, representative_contact_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
                   $17, $18, $19, $20)
           ON CONFLICT (lead_id) DO UPDATE SET
               recipient = EXCLUDED.recipient,
               recipient_is_payer = EXCLUDED.recipient_is_payer,
               recipient_type = EXCLUDED.recipient_type,
               first_name = EXCLUDED.first_name,
               last_name = EXCLUDED.last_name,
               organisation_name = EXCLUDED.organisation_name,
               legal_form = EXCLUDED.legal_form,
               contact_name = EXCLUDED.contact_name,
               street = EXCLUDED.street,
               zip = EXCLUDED.zip,
               city = EXCLUDED.city,
               country = EXCLUDED.country,
               email = EXCLUDED.email,
               phone = EXCLUDED.phone,
               relationship_kind = EXCLUDED.relationship_kind,
               relationship = EXCLUDED.relationship,
               payment_reason = EXCLUDED.payment_reason,
               updated_by = EXCLUDED.updated_by,
               representative_contact_id = EXCLUDED.representative_contact_id,
               updated_at = now()"#,
    )
    .bind(lead_id)
    .bind(&recipient.recipient)
    .bind(recipient.is_payer)
    .bind(&recipient.recipient_type)
    .bind(&recipient.first_name)
    .bind(&recipient.last_name)
    .bind(&recipient.organisation_name)
    .bind(&recipient.legal_form)
    .bind(&recipient.contact_name)
    .bind(&recipient.street)
    .bind(&recipient.zip)
    .bind(&recipient.city)
    .bind(&recipient.country)
    .bind(&recipient.email)
    .bind(&recipient.phone)
    .bind(&recipient.relationship_kind)
    .bind(&recipient.relationship)
    .bind(&recipient.payment_reason)
    .bind(actor)
    .bind(recipient.representative_contact_id)
    .execute(conn)
    .await
    .map(|_| ())
}

/// Section 7 of the declaration as the answers say it: where the invoice
/// goes, the other address (a third party who does not pay) and the e-mail
/// for invoices (never the payer's: the payer's own e-mail is on the
/// declaration). "To the payer" only while a third party pays.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct SectionSeven {
    pub(crate) invoice_to: Option<String>,
    pub(crate) invoice_name: Option<String>,
    pub(crate) invoice_street: Option<String>,
    pub(crate) invoice_zip: Option<String>,
    pub(crate) invoice_city: Option<String>,
    pub(crate) invoice_country: Option<String>,
    pub(crate) invoice_email: Option<String>,
}

impl SectionSeven {
    pub(crate) fn of_declaration(declaration: &Declaration) -> Self {
        Self {
            invoice_to: declaration.invoice_to.clone(),
            invoice_name: declaration.invoice_name.clone(),
            invoice_street: declaration.invoice_street.clone(),
            invoice_zip: declaration.invoice_zip.clone(),
            invoice_city: declaration.invoice_city.clone(),
            invoice_country: declaration.invoice_country.clone(),
            invoice_email: declaration.invoice_email.clone(),
        }
    }

    pub(crate) fn of_recipient(recipient: &Recipient, declaration: &Declaration) -> Self {
        match (recipient.recipient.as_deref(), recipient.is_payer) {
            (Some(RECIPIENT_SELF), _) if recipient.representative_contact_id.is_some() => Self {
                invoice_to: Some(INVOICE_TO_OTHER.into()),
                invoice_name: recipient.name(),
                invoice_street: recipient.street.clone(),
                invoice_zip: recipient.zip.clone(),
                invoice_city: recipient.city.clone(),
                invoice_country: recipient.country.clone(),
                invoice_email: recipient
                    .email
                    .clone()
                    .or_else(|| recipient.parent_email.clone()),
            },
            (Some(RECIPIENT_SELF), _) => Self {
                invoice_to: Some(INVOICE_TO_SELF.into()),
                invoice_email: recipient.email.clone(),
                ..Self::default()
            },
            (Some(RECIPIENT_THIRD_PARTY), Some(true))
                if recipient_matches_payer(recipient, declaration) =>
            {
                Self {
                    invoice_to: Some(INVOICE_TO_PAYER.into()),
                    ..Self::default()
                }
            }
            (Some(RECIPIENT_THIRD_PARTY), Some(false)) => Self {
                invoice_to: Some(INVOICE_TO_OTHER.into()),
                invoice_name: recipient.name(),
                invoice_street: recipient.street.clone(),
                invoice_zip: recipient.zip.clone(),
                invoice_city: recipient.city.clone(),
                invoice_country: recipient.country.clone(),
                invoice_email: recipient.email.clone(),
            },
            _ => Self::default(),
        }
    }
}

/// Writes section 7 of the declaration from the stored answers, in the
/// caller's transaction, and audits the changed keys
/// (`lead_portal_update_billing`, names only). Nothing without a row of
/// answers (an older request keeps its section 7) or without a declaration
/// (nobody is named as payer yet; the next save of the payer derives it).
/// Returns the changed keys.
pub(crate) async fn sync_section_seven(
    conn: &mut PgConnection,
    lead_id: Uuid,
    actor: Uuid,
    access_kind: &str,
) -> Result<Vec<&'static str>, sqlx::Error> {
    let Some(mut recipient) = load(conn, lead_id).await? else {
        return Ok(Vec::new());
    };
    let Some(declaration) = lead_payer::load_declaration(conn, lead_id).await? else {
        return Ok(Vec::new());
    };
    let before = SectionSeven::of_declaration(&declaration);
    let representation = super::lead_representatives::load(conn, lead_id)
        .await?
        .unwrap_or_default();
    let after = if resolve_parent(&mut recipient, &representation.representation).is_ok() {
        SectionSeven::of_recipient(&recipient, &declaration)
    } else {
        // A removed representative can no longer receive a new invoice.
        SectionSeven::default()
    };
    let changed: Vec<&'static str> = [
        ("invoice_to", before.invoice_to != after.invoice_to),
        ("invoice_name", before.invoice_name != after.invoice_name),
        (
            "invoice_street",
            before.invoice_street != after.invoice_street,
        ),
        ("invoice_zip", before.invoice_zip != after.invoice_zip),
        ("invoice_city", before.invoice_city != after.invoice_city),
        (
            "invoice_country",
            before.invoice_country != after.invoice_country,
        ),
        ("invoice_email", before.invoice_email != after.invoice_email),
    ]
    .into_iter()
    .filter_map(|(key, changed)| changed.then_some(key))
    .collect();
    if changed.is_empty() {
        return Ok(changed);
    }
    sqlx::query(
        r#"UPDATE lead_payer_declarations
           SET invoice_to = $2, invoice_name = $3, invoice_street = $4, invoice_zip = $5,
               invoice_city = $6, invoice_country = $7, invoice_email = $8,
               updated_by = $9, updated_at = now()
           WHERE lead_id = $1"#,
    )
    .bind(lead_id)
    .bind(&after.invoice_to)
    .bind(&after.invoice_name)
    .bind(&after.invoice_street)
    .bind(&after.invoice_zip)
    .bind(&after.invoice_city)
    .bind(&after.invoice_country)
    .bind(&after.invoice_email)
    .bind(actor)
    .execute(&mut *conn)
    .await?;
    audit::write_in_transaction(
        conn,
        &audit::domain_event(
            "lead_portal_update_billing",
            Some(actor),
            "lead",
            Some(lead_id),
            json!({
                "fields": changed,
                "access_kind": access_kind,
                "source": "invoice_recipient",
            }),
        ),
    )
    .await?;
    Ok(changed)
}

/// Resolve a selected parent from the same canonical representation used for
/// signatures. The browser sends only an id, never authoritative identity data.
pub(crate) fn resolve_parent(
    recipient: &mut Recipient,
    representation: &super::lead_representatives::Representation,
) -> Result<(), FieldError> {
    let id = match recipient.representative_contact_id {
        Some(id) => id,
        None if representation.minor && recipient.recipient.as_deref() == Some(RECIPIENT_SELF) => {
            let parents: Vec<_> = representation
                .representatives
                .iter()
                .filter(|person| matches!(person.slot, Some("rep1" | "rep2")))
                .collect();
            if parents.len() != 1 {
                return Ok(());
            }
            recipient.representative_contact_id = Some(parents[0].id);
            parents[0].id
        }
        None => return Ok(()),
    };
    let person = representation
        .representatives
        .iter()
        .find(|person| person.id == id && matches!(person.slot, Some("rep1" | "rep2")));
    let Some(person) = person
        .filter(|_| representation.minor && recipient.recipient.as_deref() == Some(RECIPIENT_SELF))
    else {
        return Err(field_error(
            "recipient_representative_id",
            "Choose a current parent or legal guardian of this child",
        ));
    };
    recipient.recipient_type = Some(RECIPIENT_TYPE_PERSON.into());
    recipient.first_name = Some(person.first_name.clone());
    recipient.last_name = Some(person.last_name.clone());
    recipient.street = person.extras.street.clone();
    recipient.zip = person.extras.zip.clone();
    recipient.city = person.extras.city.clone();
    recipient.country = person.extras.country.clone();
    recipient.phone = person.phone.clone();
    recipient.parent_email = person.email.clone();
    recipient.parent_date_of_birth = person.date_of_birth;
    Ok(())
}

pub(crate) fn parent_choice_missing(
    recipient: &Recipient,
    representation: &super::lead_representatives::Representation,
) -> bool {
    if !representation.minor || recipient.recipient.as_deref() != Some(RECIPIENT_SELF) {
        return false;
    }
    let parents: Vec<_> = representation
        .representatives
        .iter()
        .filter(|person| matches!(person.slot, Some("rep1" | "rep2")))
        .collect();
    match recipient.representative_contact_id {
        Some(id) => !parents.iter().any(|person| person.id == id),
        None => parents.len() > 1,
    }
}

pub(crate) fn parent_recipient_missing(
    recipient: &Recipient,
    representation: &super::lead_representatives::Representation,
) -> Vec<String> {
    if parent_choice_missing(recipient, representation) {
        return vec!["recipient_representative_id".into()];
    }
    // The first inquiry keeps the short parent form. Address and document
    // details are enforced by the existing contract-stage parent gates.
    Vec::new()
}

/// Whether the payer named in the declaration answers step 3 as the lead
/// answered it: with the patient side as recipient who pays, the patient
/// himself or a minor's paying parent (`paying_parent`); as recipient who
/// does not pay, "another person or organisation" (a third party); a
/// third-party recipient who pays, a third party; a third-party recipient who
/// does not pay, "the patient" (the patient himself or, for a parent's login,
/// the paying parent) or "another person or organisation" other than the
/// recipient. Until then the cabinet asks "who pays" (`payer_kind`) and none
/// of the payer's keys.
pub(crate) fn payer_fits(
    recipient: &Recipient,
    declaration: Option<&Declaration>,
    paying_parent: bool,
) -> bool {
    let Some(declaration) = declaration else {
        return false;
    };
    let third_party = declaration.is_third_party();
    if recipient.recipient.as_deref() == Some(RECIPIENT_SELF)
        && recipient.representative_contact_id.is_some()
    {
        let same = !declaration.is_organisation()
            && match (
                recipient.parent_email.as_deref(),
                declaration.email.as_deref(),
            ) {
                (Some(parent), Some(payer)) if !parent.is_empty() && !payer.is_empty() => {
                    parent.trim().eq_ignore_ascii_case(payer.trim())
                }
                _ => {
                    recipient.parent_date_of_birth.is_some()
                        && recipient.parent_date_of_birth == declaration.date_of_birth
                        && match (recipient.name(), declaration.payer_name()) {
                            (Some(recipient), Some(payer)) => same_name(&recipient, &payer),
                            _ => false,
                        }
                }
            };
        return match recipient.is_payer {
            Some(true) => third_party && same,
            Some(false) => third_party && !same,
            None => false,
        };
    }
    match (recipient.recipient.as_deref(), recipient.is_payer) {
        (Some(RECIPIENT_SELF), Some(true)) => !third_party || paying_parent,
        (Some(RECIPIENT_SELF), Some(false)) => third_party && !paying_parent,
        (Some(RECIPIENT_THIRD_PARTY), Some(true)) => {
            recipient_matches_payer(recipient, declaration)
        }
        (Some(RECIPIENT_THIRD_PARTY), Some(false)) => {
            !third_party
                || match (declaration.payer_name(), recipient.name()) {
                    (Some(payer), Some(name)) => !same_name(&payer, &name),
                    _ => true,
                }
        }
        _ => false,
    }
}

pub(crate) fn recipient_matches_payer(recipient: &Recipient, declaration: &Declaration) -> bool {
    if !recipient.is_third_party()
        || !declaration.is_third_party()
        || recipient.recipient_type.is_none()
        || recipient.is_organisation() != declaration.is_organisation()
    {
        return false;
    }
    if !recipient.is_organisation()
        && (recipient
            .first_name
            .as_deref()
            .is_none_or(|s| s.trim().is_empty())
            || recipient
                .last_name
                .as_deref()
                .is_none_or(|s| s.trim().is_empty()))
    {
        return false;
    }
    match (recipient.name(), declaration.payer_name()) {
        (Some(recipient), Some(payer)) => same_name(&recipient, &payer),
        _ => false,
    }
}

pub(crate) fn same_name(left: &str, right: &str) -> bool {
    let normalized = |value: &str| {
        value
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .to_lowercase()
    };
    normalized(left) == normalized(right)
}

/// Whether the payer question is shown at all: once the recipient and
/// whether it pays are answered.
pub(crate) fn payer_question_reached(recipient: &Recipient) -> bool {
    recipient.recipient.is_some() && recipient.is_payer.is_some()
}

/// What the cabinet still needs of the recipient before sending, in form
/// order: the two answers and, for a third party, the type and its data —
/// a person's name, address and relationship, an organisation's name, seat
/// and reason. A paying recipient also needs its full invoice address; payer
/// extras and consent are checked separately.
pub(crate) fn missing(recipient: &Recipient) -> Vec<&'static str> {
    let mut missing = Vec::new();
    let Some(answer) = recipient.recipient.as_deref() else {
        return vec!["invoice_recipient"];
    };
    let blank =
        |value: &Option<String>| value.as_deref().is_none_or(|value| value.trim().is_empty());
    // "Another address" of an older request names nobody's type or
    // relationship: its name and address count, as they did.
    let legacy = recipient.legacy_name.is_some();
    if answer == RECIPIENT_THIRD_PARTY {
        match recipient.recipient_type.as_deref() {
            None if legacy => {}
            None => missing.push("recipient_type"),
            Some(RECIPIENT_TYPE_ORGANISATION) => {
                if blank(&recipient.organisation_name) {
                    missing.push("recipient_organisation_name");
                }
            }
            Some(_) => {
                if blank(&recipient.first_name) {
                    missing.push("recipient_first_name");
                }
                if blank(&recipient.last_name) {
                    missing.push("recipient_last_name");
                }
            }
        }
        for (key, value) in [
            ("recipient_street", &recipient.street),
            ("recipient_zip", &recipient.zip),
            ("recipient_city", &recipient.city),
        ] {
            if blank(value) {
                missing.push(key);
            }
        }
        if recipient.country.is_none() {
            missing.push("recipient_country");
        }
        match recipient.recipient_type.as_deref() {
            Some(RECIPIENT_TYPE_ORGANISATION) => {
                if recipient.is_payer != Some(true) && blank(&recipient.payment_reason) {
                    missing.push("recipient_payment_reason");
                }
            }
            Some(_) => match recipient.relationship_kind.as_deref() {
                None => missing.push("recipient_relationship_kind"),
                Some(RELATIONSHIP_KIND_OTHER) if blank(&recipient.relationship) => {
                    missing.push("recipient_relationship");
                }
                Some(_) => {}
            },
            None => {}
        }
    }
    if recipient.is_payer.is_none() {
        missing.push("invoice_recipient_is_payer");
    }
    missing
}

#[cfg(test)]
mod tests {
    use super::*;

    fn body(value: Value) -> Map<String, Value> {
        value.as_object().cloned().unwrap()
    }

    fn third_party_payer(first: &str, last: &str) -> Declaration {
        Declaration {
            payer_kind: lead_payer::PAYER_KIND_THIRD_PARTY.into(),
            payer_type: Some("person".into()),
            first_name: Some(first.into()),
            last_name: Some(last.into()),
            ..Declaration::default()
        }
    }

    #[test]
    fn answers_are_validated_and_dependent_data_cleared() {
        let person = apply(
            &Recipient::default(),
            &body(json!({
                "invoice_recipient": "third_party",
                "recipient_type": "person",
                "recipient_first_name": "  Viktor ",
                "recipient_last_name": "Zahler",
                "recipient_country": "de",
                "recipient_relationship_kind": "friend",
                "recipient_relationship": "kept only for other",
                "recipient_email": "viktor@example.com",
            })),
        )
        .unwrap();
        assert_eq!(person.first_name.as_deref(), Some("Viktor"));
        assert_eq!(person.country.as_deref(), Some("DE"));
        assert_eq!(person.relationship, None);
        assert_eq!(person.name().as_deref(), Some("Viktor Zahler"));
        // The recipient pays unless the lead unticks it (owner 2026-10-11).
        assert_eq!(person.is_payer, Some(true));
        let unticked = apply(
            &person,
            &body(json!({ "invoice_recipient_is_payer": false })),
        )
        .unwrap();
        assert_eq!(unticked.is_payer, Some(false));
        let cleared = apply(
            &unticked,
            &body(json!({ "invoice_recipient_is_payer": null })),
        )
        .unwrap();
        assert_eq!(cleared.is_payer, Some(true));
        let none = apply(&person, &body(json!({ "invoice_recipient": null }))).unwrap();
        assert_eq!(none.is_payer, None);

        // An organisation has no person's data.
        let organisation = apply(
            &person,
            &body(json!({
                "recipient_type": "organisation",
                "recipient_organisation_name": "Beispiel GmbH",
                "recipient_payment_reason": "Arbeitgeber übernimmt die Rechnung",
            })),
        )
        .unwrap();
        assert_eq!(organisation.first_name, None);
        assert_eq!(organisation.relationship_kind, None);
        assert_eq!(organisation.name().as_deref(), Some("Beispiel GmbH"));

        // An organisation that pays states its reason as the payer's.
        let paying = apply(
            &organisation,
            &body(json!({ "invoice_recipient_is_payer": true })),
        )
        .unwrap();
        assert_eq!(paying.payment_reason, None);

        // The patient side as recipient: the third party goes, and so does its
        // e-mail; the answer whether the recipient pays stays.
        let own = apply(&organisation, &body(json!({ "invoice_recipient": "self" }))).unwrap();
        assert_eq!(
            own,
            Recipient {
                recipient: Some("self".into()),
                is_payer: Some(true),
                ..Recipient::default()
            }
        );
        let own = apply(
            &own,
            &body(json!({ "recipient_email": "rechnung@example.com" })),
        )
        .unwrap();
        assert_eq!(own.email.as_deref(), Some("rechnung@example.com"));

        for (key, value) in [
            ("invoice_recipient", json!("insurer")),
            ("invoice_recipient_is_payer", json!("yes")),
            ("recipient_type", json!("company")),
            ("recipient_country", json!("Germany")),
            ("recipient_email", json!("no-at-sign")),
            ("recipient_relationship_kind", json!("cousin")),
            ("recipient_zip", json!("1".repeat(21))),
            ("unknown", json!("x")),
        ] {
            assert!(
                apply(&Recipient::default(), &body(json!({ key: value }))).is_err(),
                "{key}"
            );
        }
    }

    #[test]
    fn section_seven_follows_the_answers() {
        let payer = third_party_payer("Viktor", "Zahler");
        let own = Recipient {
            recipient: Some("self".into()),
            is_payer: Some(false),
            email: Some("rechnung@example.com".into()),
            ..Recipient::default()
        };
        assert_eq!(
            SectionSeven::of_recipient(&own, &payer),
            SectionSeven {
                invoice_to: Some("self".into()),
                invoice_email: Some("rechnung@example.com".into()),
                ..SectionSeven::default()
            }
        );
        let paying = Recipient {
            recipient: Some("third_party".into()),
            is_payer: Some(true),
            recipient_type: Some("person".into()),
            first_name: Some("Viktor".into()),
            last_name: Some("Zahler".into()),
            ..Recipient::default()
        };
        assert_eq!(
            SectionSeven::of_recipient(&paying, &payer)
                .invoice_to
                .as_deref(),
            Some("payer")
        );
        // "To the payer" only while a third party pays.
        assert_eq!(
            SectionSeven::of_recipient(&paying, &Declaration::default()).invoice_to,
            None
        );
        let other = Recipient {
            recipient: Some("third_party".into()),
            is_payer: Some(false),
            recipient_type: Some("organisation".into()),
            organisation_name: Some("Beispiel GmbH".into()),
            street: Some("Hauptstraße 1".into()),
            zip: Some("10115".into()),
            city: Some("Berlin".into()),
            country: Some("DE".into()),
            ..Recipient::default()
        };
        let section = SectionSeven::of_recipient(&other, &Declaration::default());
        assert_eq!(section.invoice_to.as_deref(), Some("other"));
        assert_eq!(section.invoice_name.as_deref(), Some("Beispiel GmbH"));
        assert_eq!(section.invoice_city.as_deref(), Some("Berlin"));
    }

    #[test]
    fn older_requests_are_read_from_section_seven() {
        let mut own = Declaration {
            payer_kind: lead_payer::PAYER_KIND_SELF.into(),
            invoice_to: Some("self".into()),
            ..Declaration::default()
        };
        let derived_own = derived(Some(&own), false);
        assert_eq!(derived_own.recipient.as_deref(), Some("self"));
        assert_eq!(derived_own.is_payer, Some(true));
        own.invoice_to = Some("other".into());
        own.invoice_name = Some("Mia Muster".into());
        let derived_other = derived(Some(&own), false);
        assert_eq!(derived_other.recipient.as_deref(), Some("third_party"));
        assert_eq!(derived_other.is_payer, Some(false));
        assert_eq!(derived_other.name().as_deref(), Some("Mia Muster"));
        let mut payer = third_party_payer("Viktor", "Zahler");
        payer.invoice_to = Some("payer".into());
        let derived_payer = derived(Some(&payer), false);
        assert_eq!(derived_payer.is_payer, Some(true));
        assert_eq!(derived_payer.name().as_deref(), Some("Viktor Zahler"));
        payer.invoice_to = Some("self".into());
        assert_eq!(derived(Some(&payer), false).is_payer, Some(false));
        assert_eq!(derived(Some(&payer), true).is_payer, Some(true));
        assert_eq!(derived(None, false), Recipient::default());
    }

    #[test]
    fn the_payer_must_fit_the_answers() {
        let own_payer = Declaration {
            payer_kind: lead_payer::PAYER_KIND_SELF.into(),
            ..Declaration::default()
        };
        let viktor = third_party_payer("Viktor", "Zahler");
        let answers = |recipient: &str, is_payer: bool| Recipient {
            recipient: Some(recipient.into()),
            is_payer: Some(is_payer),
            ..Recipient::default()
        };
        assert!(payer_fits(&answers("self", true), Some(&own_payer), false));
        assert!(!payer_fits(&answers("self", true), Some(&viktor), false));
        assert!(payer_fits(&answers("self", true), Some(&viktor), true));
        assert!(!payer_fits(
            &answers("self", false),
            Some(&own_payer),
            false
        ));
        assert!(payer_fits(&answers("self", false), Some(&viktor), false));
        assert!(!payer_fits(
            &answers("third_party", true),
            Some(&viktor),
            false
        ));
        assert!(!payer_fits(
            &answers("third_party", true),
            Some(&own_payer),
            false
        ));
        assert!(payer_fits(
            &answers("third_party", false),
            Some(&own_payer),
            false
        ));
        // The recipient who does not pay is not the payer named.
        let mut recipient = answers("third_party", false);
        recipient.recipient_type = Some("person".into());
        recipient.first_name = Some("viktor".into());
        recipient.last_name = Some("ZAHLER".into());
        assert!(!payer_fits(&recipient, Some(&viktor), false));
        recipient.is_payer = Some(true);
        assert!(payer_fits(&recipient, Some(&viktor), false));
        assert!(!payer_fits(&answers("self", false), Some(&viktor), true));
        recipient.first_name = Some("Mia".into());
        assert!(!payer_fits(&recipient, Some(&viktor), false));
        recipient.is_payer = Some(false);
        assert!(payer_fits(&recipient, Some(&viktor), false));
        assert!(!payer_fits(&answers("self", true), None, false));
        assert!(!payer_fits(&Recipient::default(), Some(&own_payer), false));
    }

    #[test]
    fn missing_keys_follow_the_form() {
        assert_eq!(missing(&Recipient::default()), ["invoice_recipient"]);
        let mut recipient = Recipient {
            recipient: Some("self".into()),
            ..Recipient::default()
        };
        assert_eq!(missing(&recipient), ["invoice_recipient_is_payer"]);
        recipient.is_payer = Some(true);
        assert!(missing(&recipient).is_empty());
        let mut third = Recipient {
            recipient: Some("third_party".into()),
            ..Recipient::default()
        };
        assert_eq!(
            missing(&third),
            [
                "recipient_type",
                "recipient_street",
                "recipient_zip",
                "recipient_city",
                "recipient_country",
                "invoice_recipient_is_payer",
            ]
        );
        third.recipient_type = Some("person".into());
        third.is_payer = Some(false);
        third.relationship_kind = Some("other".into());
        assert_eq!(
            missing(&third),
            [
                "recipient_first_name",
                "recipient_last_name",
                "recipient_street",
                "recipient_zip",
                "recipient_city",
                "recipient_country",
                "recipient_relationship",
            ]
        );
        third.recipient_type = Some("organisation".into());
        assert_eq!(
            missing(&third),
            [
                "recipient_organisation_name",
                "recipient_street",
                "recipient_zip",
                "recipient_city",
                "recipient_country",
                "recipient_payment_reason",
            ]
        );
        // A third party who pays: the payer's keys count.
        third.is_payer = Some(true);
        assert_eq!(
            missing(&third),
            [
                "recipient_organisation_name",
                "recipient_street",
                "recipient_zip",
                "recipient_city",
                "recipient_country"
            ]
        );
    }
}
