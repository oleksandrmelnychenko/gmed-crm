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
//! The answers live in `lead_invoice_recipients`, the one source of the
//! invoice recipient (2026-10-23); the payer stays the payer declaration
//! (`lead_payer_declarations`), which the risk triggers, the payer link, the
//! payer package and the GwG sheets read. "Section 7" of the declaration
//! (`invoice_to` and the other address), which the invoice chain, the patient
//! card and the GwG sheets read, is derived from the answers whenever a
//! declaration is read ([`load_for_lead`], [`LeadRecipient::section_seven`],
//! [`fill_section_seven`]): `self`, `payer` for a third party who pays,
//! `other` with the recipient's name and address for a third party who does
//! not or for a minor's parent named as recipient. The columns of section 7
//! on the declaration are history and no longer written. Requests sent before
//! 2026-10-11 got a row from their section 7 in migration
//! `20261023100000_lead_invoice_recipient_single_source` (`legacy_name`,
//! `from_section_seven`).

use serde_json::{Map, Value, json};
use sqlx::{PgConnection, Row, postgres::PgRow};
use uuid::Uuid;

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
    /// The name section 7 of a request sent before the recipient flow gave
    /// "another address" (`invoice_name`, person or organisation unsaid),
    /// kept as written until the lead names the recipient's type.
    pub(crate) legacy_name: Option<String>,
    /// The row was made from section 7 by the migration and the lead has not
    /// changed the answers since: a minor's only parent is not named as the
    /// recipient automatically ([`load_for_lead`]).
    pub(crate) from_section_seven: bool,
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
            legacy_name: text("legacy_name"),
            from_section_seven: row
                .try_get::<bool, _>("from_section_seven")
                .unwrap_or(false),
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
    /// the name section 7 of an older request gave ([`Self::legacy_name`]).
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

/// The invoice recipient of a lead as the readers outside the cabinet take
/// it: the stored answers with a minor's parent resolved from the current
/// representation ([`resolve_parent`]).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct LeadRecipient {
    pub(crate) answers: Recipient,
    /// The parent named as recipient is no longer a parent or legal guardian
    /// of the child: a new invoice is not addressed to that person.
    pub(crate) parent_removed: bool,
}

impl LeadRecipient {
    /// Section 7 of the declaration as the answers say it.
    pub(crate) fn section_seven(&self, declaration: &Declaration) -> SectionSeven {
        if self.parent_removed {
            SectionSeven::default()
        } else {
            SectionSeven::of_recipient(&self.answers, declaration)
        }
    }
}

/// The one reader of the invoice recipient outside the cabinet's own
/// handlers: the row of `lead_invoice_recipients` (`None` before the lead
/// answered), with the parent named as recipient — or a minor's only parent
/// when the patient side receives the invoice — resolved from the
/// representation. A converted lead is read as of its conversion day, so the
/// parents of a child who has turned 18 since stay its parents here. A row
/// made from an older request's section 7 that the lead has not changed
/// names no parent of its own: "to me" stays the contracting party, as the
/// invoices read it before.
pub(crate) async fn load_for_lead(
    conn: &mut PgConnection,
    lead_id: Uuid,
) -> Result<Option<LeadRecipient>, sqlx::Error> {
    let Some(row) = sqlx::query(
        r#"SELECT r.*, l.converted_patient_id IS NOT NULL AS lead_converted,
                  l.status_changed_at AS lead_status_changed_at
           FROM lead_invoice_recipients r
           JOIN leads l ON l.id = r.lead_id
           WHERE r.lead_id = $1"#,
    )
    .bind(lead_id)
    .fetch_optional(&mut *conn)
    .await?
    else {
        return Ok(None);
    };
    let mut answers = Recipient::from_row(&row);
    let names_parent = answers.recipient.as_deref() == Some(RECIPIENT_SELF)
        && !(answers.from_section_seven && answers.representative_contact_id.is_none());
    if !names_parent {
        return Ok(Some(LeadRecipient {
            answers,
            parent_removed: false,
        }));
    }
    let converted = row.try_get::<bool, _>("lead_converted").unwrap_or(false);
    let on = row
        .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("lead_status_changed_at")
        .ok()
        .flatten()
        .filter(|_| converted)
        .map(crate::app_time::date_of)
        .unwrap_or_else(crate::app_time::today);
    let representation = super::lead_representatives::load_on(conn, lead_id, on)
        .await?
        .unwrap_or_default();
    let parent_removed = resolve_parent(&mut answers, &representation.representation).is_err();
    Ok(Some(LeadRecipient {
        answers,
        parent_removed,
    }))
}

/// Sets section 7 of `declaration` (`invoice_to` and the other address with
/// the e-mail for invoices) from the lead's invoice recipient; nothing
/// answered, nothing set. Every load of a declaration calls it
/// (`lead_payer::load_declaration`, `lead_payer::patient_declaration`), so
/// no reader sees the history kept in the columns.
pub(crate) async fn fill_section_seven(
    conn: &mut PgConnection,
    lead_id: Uuid,
    declaration: &mut Declaration,
) -> Result<(), sqlx::Error> {
    let section = match load_for_lead(conn, lead_id).await? {
        Some(recipient) => recipient.section_seven(declaration),
        None => SectionSeven::default(),
    };
    section.write_to(declaration);
    Ok(())
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
    // The lead answers now: the rules of the cabinet apply from here on.
    next.from_section_seven = false;
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
    // The free name of an older request's "another address" stays only while
    // the third party has no type, and so no name of its own.
    if !next.is_third_party() || next.recipient_type.is_some() {
        next.legacy_name = None;
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
               phone, relationship_kind, relationship, payment_reason, updated_by, representative_contact_id,
               legacy_name, from_section_seven)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
                   $17, $18, $19, $20, $21, $22)
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
               legacy_name = EXCLUDED.legacy_name,
               from_section_seven = EXCLUDED.from_section_seven,
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
    .bind(&recipient.legacy_name)
    .bind(recipient.from_section_seven)
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
    /// Section 7 as a declaration read through [`fill_section_seven`] holds it.
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

    /// Puts this section 7 on `declaration` (read-only there: never stored).
    pub(crate) fn write_to(self, declaration: &mut Declaration) {
        declaration.invoice_to = self.invoice_to;
        declaration.invoice_name = self.invoice_name;
        declaration.invoice_street = self.invoice_street;
        declaration.invoice_zip = self.invoice_zip;
        declaration.invoice_city = self.invoice_city;
        declaration.invoice_country = self.invoice_country;
        declaration.invoice_email = self.invoice_email;
    }

    /// The keys whose value differs from `other`, in form order.
    pub(crate) fn changed_keys(&self, other: &Self) -> Vec<&'static str> {
        [
            ("invoice_to", self.invoice_to != other.invoice_to),
            ("invoice_name", self.invoice_name != other.invoice_name),
            (
                "invoice_street",
                self.invoice_street != other.invoice_street,
            ),
            ("invoice_zip", self.invoice_zip != other.invoice_zip),
            ("invoice_city", self.invoice_city != other.invoice_city),
            (
                "invoice_country",
                self.invoice_country != other.invoice_country,
            ),
            ("invoice_email", self.invoice_email != other.invoice_email),
        ]
        .into_iter()
        .filter_map(|(key, changed)| changed.then_some(key))
        .collect()
    }
}

/// What a change of the cabinet did to the derived section 7 — the answers
/// of step 3, or the payer named — and the audit event that names the
/// changed keys (`lead_portal_update_billing`, `source = invoice_recipient`,
/// names only), in the caller's transaction. `before` is the declaration as
/// read before the change (`None`: nobody was named as payer, so section 7
/// was empty); nothing while nobody is named as payer now (section 7 is read
/// with the payer). Returns the changed keys.
pub(crate) async fn audit_section_seven_change(
    conn: &mut PgConnection,
    lead_id: Uuid,
    before: Option<&Declaration>,
    actor: Uuid,
    access_kind: &str,
) -> Result<Vec<&'static str>, sqlx::Error> {
    let Some(after) = lead_payer::load_declaration(&mut *conn, lead_id).await? else {
        return Ok(Vec::new());
    };
    let changed = before
        .map(SectionSeven::of_declaration)
        .unwrap_or_default()
        .changed_keys(&SectionSeven::of_declaration(&after));
    if changed.is_empty() {
        return Ok(changed);
    }
    crate::audit::write_in_transaction(
        conn,
        &crate::audit::domain_event(
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
    // Stored as an ISO code (the column's check): a parent's country read
    // from a linked patient record may be a name ("Ukraine", DEV 2026-10-21).
    recipient.country = person
        .extras
        .country
        .as_deref()
        .and_then(crate::services::lead_guardian_identity::iso_country);
    recipient.phone = person.phone.clone();
    recipient.parent_email = person.email.clone();
    recipient.parent_date_of_birth = person.date_of_birth;
    Ok(())
}

/// "Ich (als Elternteil / gesetzliche Vertretung)" of a parent's login is that
/// parent (owner 2026-10-21): the patient side of a minor as recipient
/// without a named parent gets the parent whose login `user_id` is, when that
/// parent has a place in the form. Another parent stays a deliberate choice,
/// checked by [`resolve_parent`].
pub(crate) fn default_parent_to_viewer(
    recipient: &mut Recipient,
    representation: &super::lead_representatives::Representation,
    user_id: Uuid,
) {
    if !representation.minor
        || recipient.recipient.as_deref() != Some(RECIPIENT_SELF)
        || recipient.representative_contact_id.is_some()
    {
        return;
    }
    if let Some(person) = representation.representatives.iter().find(|person| {
        matches!(person.slot, Some("rep1" | "rep2")) && person.login_user_ids.contains(&user_id)
    }) {
        recipient.representative_contact_id = Some(person.id);
    }
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
    // A minor's representative named as payer (owner decision 2026-10-19):
    // the parent chosen as recipient pays, or the other one does.
    if declaration.is_representative() {
        return match (
            recipient.recipient.as_deref(),
            recipient.representative_contact_id,
            recipient.is_payer,
        ) {
            (Some(RECIPIENT_SELF), Some(parent), Some(true)) => {
                declaration.payer_representative_id == Some(parent)
            }
            (Some(RECIPIENT_SELF), Some(parent), Some(false)) => {
                declaration.payer_representative_id != Some(parent)
            }
            (Some(RECIPIENT_SELF), None, Some(true)) => true,
            (Some(RECIPIENT_THIRD_PARTY), _, Some(false)) => true,
            _ => false,
        };
    }
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

    /// The rows migration `20261023100000_lead_invoice_recipient_single_source`
    /// makes of an older request's section 7 read back as the same section 7
    /// (the invoice chain, the patient card and the GwG sheets see no
    /// change), and the cabinet reads the same answers it derived before.
    #[test]
    fn rows_made_from_section_seven_read_back_as_before() {
        let own_payer = Declaration {
            payer_kind: lead_payer::PAYER_KIND_SELF.into(),
            ..Declaration::default()
        };
        // invoice_to = 'self' with the e-mail for invoices.
        let own = LeadRecipient {
            answers: Recipient {
                recipient: Some("self".into()),
                is_payer: Some(true),
                email: Some("rechnung@example.com".into()),
                from_section_seven: true,
                ..Recipient::default()
            },
            parent_removed: false,
        };
        assert_eq!(
            own.section_seven(&own_payer),
            SectionSeven {
                invoice_to: Some("self".into()),
                invoice_email: Some("rechnung@example.com".into()),
                ..SectionSeven::default()
            }
        );
        assert!(payer_fits(&own.answers, Some(&own_payer), false));

        // invoice_to = 'other': the name as written, the address and e-mail.
        let other = LeadRecipient {
            answers: Recipient {
                recipient: Some("third_party".into()),
                is_payer: Some(false),
                street: Some("Nebenweg 2".into()),
                zip: Some("10115".into()),
                city: Some("Berlin".into()),
                country: Some("DE".into()),
                email: Some("rechnung@example.com".into()),
                legacy_name: Some("Mia Muster".into()),
                from_section_seven: true,
                ..Recipient::default()
            },
            parent_removed: false,
        };
        assert_eq!(
            other.section_seven(&own_payer),
            SectionSeven {
                invoice_to: Some("other".into()),
                invoice_name: Some("Mia Muster".into()),
                invoice_street: Some("Nebenweg 2".into()),
                invoice_zip: Some("10115".into()),
                invoice_city: Some("Berlin".into()),
                invoice_country: Some("DE".into()),
                invoice_email: Some("rechnung@example.com".into()),
            }
        );
        // The old "another address" asked no type: its name and address count.
        assert!(missing(&other.answers).is_empty());
        assert_eq!(other.answers.name().as_deref(), Some("Mia Muster"));

        // invoice_to = 'payer': the payer's own data, so it is the payer.
        let mut viktor = third_party_payer("Viktor", "Zahler");
        viktor.street = Some("Zahlerweg 1".into());
        viktor.email = Some("viktor@example.com".into());
        let paying = LeadRecipient {
            answers: Recipient {
                recipient: Some("third_party".into()),
                is_payer: Some(true),
                recipient_type: Some("person".into()),
                first_name: Some("Viktor".into()),
                last_name: Some("Zahler".into()),
                street: Some("Zahlerweg 1".into()),
                email: Some("viktor@example.com".into()),
                from_section_seven: true,
                ..Recipient::default()
            },
            parent_removed: false,
        };
        assert_eq!(
            paying.section_seven(&viktor),
            SectionSeven {
                invoice_to: Some("payer".into()),
                ..SectionSeven::default()
            }
        );
        assert!(payer_fits(&paying.answers, Some(&viktor), false));

        // A parent no longer on file receives no new invoice.
        let removed = LeadRecipient {
            parent_removed: true,
            ..own.clone()
        };
        assert_eq!(removed.section_seven(&own_payer), SectionSeven::default());

        // The section is written onto the declaration as read.
        let mut declaration = own_payer.clone();
        other.section_seven(&own_payer).write_to(&mut declaration);
        assert_eq!(declaration.invoice_name.as_deref(), Some("Mia Muster"));
        assert_eq!(
            SectionSeven::of_declaration(&declaration),
            other.section_seven(&own_payer)
        );
        assert_eq!(
            SectionSeven::default().changed_keys(&SectionSeven::of_declaration(&declaration)),
            [
                "invoice_to",
                "invoice_name",
                "invoice_street",
                "invoice_zip",
                "invoice_city",
                "invoice_country",
                "invoice_email"
            ]
        );
    }

    /// The lead's next answer ends the reading of an older request: the row is
    /// the cabinet's from then on, and the free name stays only while the
    /// third party has no type.
    #[test]
    fn an_answer_ends_the_reading_of_an_older_request() {
        let older = Recipient {
            recipient: Some("third_party".into()),
            is_payer: Some(false),
            city: Some("Berlin".into()),
            legacy_name: Some("Mia Muster".into()),
            from_section_seven: true,
            ..Recipient::default()
        };
        let email = apply(
            &older,
            &body(json!({ "recipient_email": "mia@example.com" })),
        )
        .unwrap();
        assert!(!email.from_section_seven);
        assert_eq!(email.legacy_name.as_deref(), Some("Mia Muster"));
        let typed = apply(
            &older,
            &body(json!({
                "recipient_type": "person",
                "recipient_first_name": "Mia",
                "recipient_last_name": "Muster",
            })),
        )
        .unwrap();
        assert_eq!(typed.legacy_name, None);
        assert_eq!(typed.name().as_deref(), Some("Mia Muster"));
        let own = apply(&older, &body(json!({ "invoice_recipient": "self" }))).unwrap();
        assert_eq!(own.legacy_name, None);
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

    fn parent(
        n: u128,
        slot: &'static str,
        login: Option<Uuid>,
        country: &str,
    ) -> super::super::lead_representatives::Representative {
        super::super::lead_representatives::Representative {
            id: Uuid::from_u128(n),
            slot: Some(slot),
            role: "legal_representative",
            relation: Some("parent".into()),
            first_name: format!("Parent{n}"),
            last_name: "Test".into(),
            date_of_birth: None,
            email: Some(format!("parent{n}@example.com")),
            phone: None,
            login_user_ids: login.into_iter().collect(),
            has_data: false,
            extras: super::super::lead_representatives::Extras {
                country: Some(country.into()),
                ..Default::default()
            },
        }
    }

    /// DEV 2026-10-21: "Я" of a parent's login names that parent, also with
    /// two parents, and a parent's country from a linked patient record
    /// ("Ukraine") is stored as its code, never against the column's check.
    #[test]
    fn me_is_the_signed_in_parent_and_the_country_is_a_code() {
        let viewer = Uuid::from_u128(99);
        let representation = super::super::lead_representatives::Representation {
            minor: true,
            representatives: vec![
                parent(1, "rep1", None, "DE"),
                parent(2, "rep2", Some(viewer), "Ukraine"),
            ],
            ..Default::default()
        };
        let mut recipient = apply(
            &Recipient::default(),
            &body(json!({ "invoice_recipient": "self" })),
        )
        .unwrap();
        assert!(parent_choice_missing(&recipient, &representation));
        default_parent_to_viewer(&mut recipient, &representation, viewer);
        assert_eq!(
            recipient.representative_contact_id,
            Some(Uuid::from_u128(2))
        );
        resolve_parent(&mut recipient, &representation).unwrap();
        assert_eq!(recipient.country.as_deref(), Some("UA"));
        assert!(!parent_choice_missing(&recipient, &representation));

        // A chosen parent stays; somebody who is none of the parents gets none.
        let mut chosen = apply(
            &Recipient::default(),
            &body(json!({
                "invoice_recipient": "self",
                "recipient_representative_id": Uuid::from_u128(1).to_string(),
            })),
        )
        .unwrap();
        default_parent_to_viewer(&mut chosen, &representation, viewer);
        assert_eq!(chosen.representative_contact_id, Some(Uuid::from_u128(1)));
        let mut stranger = apply(
            &Recipient::default(),
            &body(json!({ "invoice_recipient": "self" })),
        )
        .unwrap();
        default_parent_to_viewer(&mut stranger, &representation, Uuid::from_u128(7));
        assert_eq!(stranger.representative_contact_id, None);
        // An id that is no current parent is still refused.
        let mut foreign = apply(
            &Recipient::default(),
            &body(json!({
                "invoice_recipient": "self",
                "recipient_representative_id": Uuid::from_u128(5).to_string(),
            })),
        )
        .unwrap();
        assert!(resolve_parent(&mut foreign, &representation).is_err());
    }
}
