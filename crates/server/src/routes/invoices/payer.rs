//! Who an invoice is addressed to and paid by (Rechnungsempfänger, Zahler).
//!
//! A payer is one whole record: a relative (patient relation), another
//! patient record, or a free-text contact, with its own e-mail and postal
//! address. A new invoice takes the payer of its head order (a family order
//! paid by one person), else of its own order, else the patient's default
//! payer relation, else the third party the patient's payer declaration
//! names (the lead's "Кто платит", kept with the patient after conversion),
//! else the contracting party when that is the patient's legal
//! representatives (a minor's parents). The record is taken as a whole, never
//! mixed field by field from different people.
//!
//! The recipient is resolved by the database function
//! `invoice_recipient_resolve` and frozen into `recipient_snapshot` when the
//! invoice is released; [`release_recipient_snapshot`] checks it first:
//! a full postal address (§ 14 Abs. 4 Nr. 1 UStG), a minor patient as
//! recipient, a recipient other than the contracting party, and advances of
//! the order billed to someone else (§ 14 Abs. 5 Satz 2 UStG). See
//! `docs/architecture/invoice-payer-model_ua.md`.

use axum::{
    Json,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::IntoResponse,
};
use chrono::{NaiveDate, Utc};
use serde::Deserialize;
use serde_json::{Map, Value, json};
use sqlx::{PgConnection, Row, postgres::PgRow};
use uuid::Uuid;

use super::{
    coded_err, document, ensure_patient_access, err, load_invoice_detail, normalize_optional,
};
use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::routes::lead_payer;
use crate::services::contracting_party::{self, ContractingParty, PartyKind, is_minor_on};
use crate::state::AppState;
use gmed_domain::access::capabilities::Capability;

/// The recipient as `invoice_recipient_resolve` builds it, for readers
/// outside the invoice module (the patient card's payer summary).
pub(crate) use document::{InvoiceRecipient, missing_address_parts};

pub(crate) const PAYER_ROLE_CONTRACTING_PARTY: &str = "contracting_party";
pub(crate) const PAYER_ROLE_COST_BEARER: &str = "cost_bearer";

/// One payer as stored on an order or invoice.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct PayerRecord {
    pub payer_patient_id: Option<Uuid>,
    pub payer_patient_relation_id: Option<Uuid>,
    pub contact_name: Option<String>,
    pub contact_email: Option<String>,
    pub contact_phone: Option<String>,
    pub contact_relationship: Option<String>,
    pub notes: Option<String>,
    pub address_street: Option<String>,
    pub address_zip: Option<String>,
    pub address_city: Option<String>,
    pub address_country: Option<String>,
    pub payer_role: Option<String>,
}

/// Select list of the payer columns of `alias`, prefixed with `prefix`.
pub(crate) fn payer_columns(alias: &str, prefix: &str) -> String {
    [
        "payer_patient_id",
        "payer_patient_relation_id",
        "payer_contact_name",
        "payer_contact_email",
        "payer_contact_phone",
        "payer_contact_relationship",
        "payer_notes",
        "payer_address_street",
        "payer_address_zip",
        "payer_address_city",
        "payer_address_country",
        "payer_role",
    ]
    .iter()
    .map(|column| format!("{alias}.{column} AS {prefix}{column}"))
    .collect::<Vec<_>>()
    .join(", ")
}

impl PayerRecord {
    /// Someone other than the patient is named.
    pub fn is_set(&self) -> bool {
        self.payer_patient_id.is_some()
            || self.payer_patient_relation_id.is_some()
            || self.contact_name.is_some()
    }

    fn has_own_address(&self) -> bool {
        self.address_street.is_some()
            || self.address_zip.is_some()
            || self.address_city.is_some()
            || self.address_country.is_some()
    }

    /// Reads the columns selected with [`payer_columns`].
    pub fn from_row(row: &PgRow, prefix: &str) -> Self {
        let uuid = |column: &str| {
            row.try_get::<Option<Uuid>, _>(format!("{prefix}{column}").as_str())
                .unwrap_or_default()
        };
        let text = |column: &str| {
            normalize_optional(
                row.try_get::<Option<String>, _>(format!("{prefix}{column}").as_str())
                    .unwrap_or_default()
                    .as_deref(),
            )
        };
        Self {
            payer_patient_id: uuid("payer_patient_id"),
            payer_patient_relation_id: uuid("payer_patient_relation_id"),
            contact_name: text("payer_contact_name"),
            contact_email: text("payer_contact_email"),
            contact_phone: text("payer_contact_phone"),
            contact_relationship: text("payer_contact_relationship"),
            notes: text("payer_notes"),
            address_street: text("payer_address_street"),
            address_zip: text("payer_address_zip"),
            address_city: text("payer_address_city"),
            address_country: text("payer_address_country"),
            payer_role: text("payer_role"),
        }
    }

    /// Audit form: who pays, without free-text notes.
    pub fn to_audit_json(&self) -> Value {
        json!({
            "payer_patient_id": self.payer_patient_id,
            "payer_patient_relation_id": self.payer_patient_relation_id,
            "payer_contact_name": self.contact_name,
            "payer_contact_email": self.contact_email,
            "payer_contact_phone": self.contact_phone,
            "payer_contact_relationship": self.contact_relationship,
            "payer_address_street": self.address_street,
            "payer_address_zip": self.address_zip,
            "payer_address_city": self.address_city,
            "payer_address_country": self.address_country,
            "payer_role": self.payer_role,
        })
    }
}

/// A plausible e-mail address: one `@`, a local part and a dotted domain,
/// no whitespace.
pub(crate) fn is_plausible_email(value: &str) -> bool {
    let value = value.trim();
    if value.len() > 254 || value.chars().any(char::is_whitespace) {
        return false;
    }
    let Some((local, domain)) = value.split_once('@') else {
        return false;
    };
    !local.is_empty()
        && !domain.contains('@')
        && domain.contains('.')
        && !domain.starts_with('.')
        && !domain.ends_with('.')
}

/// Payer fields as sent by the order and invoice payer dialogs.
#[derive(Deserialize, Default)]
pub(crate) struct PayerInput {
    pub payer_patient_id: Option<Uuid>,
    pub payer_patient_relation_id: Option<Uuid>,
    pub payer_contact_name: Option<String>,
    pub payer_contact_email: Option<String>,
    pub payer_contact_phone: Option<String>,
    pub payer_contact_relationship: Option<String>,
    pub payer_notes: Option<String>,
    pub payer_address_street: Option<String>,
    pub payer_address_zip: Option<String>,
    pub payer_address_city: Option<String>,
    pub payer_address_country: Option<String>,
    pub payer_role: Option<String>,
    /// Patient number (`P-…`) of a payer patient record, for dialogs without
    /// a patient picker; used when `payer_patient_id` is not given.
    pub payer_patient_pid: Option<String>,
}

impl PayerInput {
    /// Turns `payer_patient_pid` into `payer_patient_id`. `Err` when no patient
    /// has that number.
    pub async fn resolve_patient_pid(
        &mut self,
        db: &sqlx::PgPool,
    ) -> Result<(), Option<sqlx::Error>> {
        let Some(pid) = normalize_optional(self.payer_patient_pid.as_deref()) else {
            return Ok(());
        };
        if self.payer_patient_id.is_some() {
            return Ok(());
        }
        match sqlx::query_scalar::<_, Uuid>("SELECT id FROM patients WHERE patient_id = $1")
            .bind(&pid)
            .fetch_optional(db)
            .await
        {
            Ok(Some(id)) => {
                self.payer_patient_id = Some(id);
                Ok(())
            }
            Ok(None) => Err(None),
            Err(error) => Err(Some(error)),
        }
    }
}

/// Response for [`PayerInput::resolve_patient_pid`] failures.
pub(crate) fn payer_pid_error(error: Option<sqlx::Error>) -> axum::response::Response {
    match error {
        None => coded_err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "payer_patient_not_found",
            "Payer patient not found",
            json!({}),
        ),
        Some(error) => {
            tracing::error!(%error, "resolve payer patient number");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to update payer")
        }
    }
}

/// Normalizes and validates a payer: `Err((code, message))` for a 422.
pub(crate) fn payer_from_input(
    input: &PayerInput,
    patient_id: Option<Uuid>,
) -> Result<PayerRecord, (&'static str, &'static str)> {
    let text = |value: &Option<String>| normalize_optional(value.as_deref());
    let mut record = PayerRecord {
        payer_patient_id: input.payer_patient_id,
        payer_patient_relation_id: input.payer_patient_relation_id,
        contact_name: text(&input.payer_contact_name),
        contact_email: text(&input.payer_contact_email),
        contact_phone: text(&input.payer_contact_phone),
        contact_relationship: text(&input.payer_contact_relationship),
        notes: text(&input.payer_notes),
        address_street: text(&input.payer_address_street),
        address_zip: text(&input.payer_address_zip),
        address_city: text(&input.payer_address_city),
        address_country: text(&input.payer_address_country),
        payer_role: text(&input.payer_role),
    };
    if record.payer_patient_id.is_some() && record.payer_patient_relation_id.is_some() {
        return Err((
            "payer_single_record",
            "A payer is either a relative or a patient record, not both",
        ));
    }
    if record.payer_patient_id.is_some() && record.payer_patient_id == patient_id {
        return Err((
            "payer_is_patient",
            "The patient cannot be their own payer; clear the payer instead",
        ));
    }
    if record
        .contact_email
        .as_deref()
        .is_some_and(|email| !is_plausible_email(email))
    {
        return Err(("payer_email_invalid", "Invalid payer e-mail address"));
    }
    let too_long = [
        &record.contact_name,
        &record.contact_relationship,
        &record.contact_phone,
        &record.address_street,
        &record.address_zip,
        &record.address_city,
        &record.address_country,
    ]
    .into_iter()
    .flatten()
    .any(|value| value.chars().count() > 200);
    if too_long
        || record
            .notes
            .as_ref()
            .is_some_and(|v| v.chars().count() > 2000)
    {
        return Err(("payer_field_too_long", "Payer field is too long"));
    }
    match record.payer_role.as_deref() {
        None | Some(PAYER_ROLE_CONTRACTING_PARTY | PAYER_ROLE_COST_BEARER) => {}
        Some(_) => return Err(("payer_role_invalid", "Invalid payer role")),
    }
    if !record.is_set() {
        // Without a payer the patient receives the invoice.
        record = PayerRecord::default();
    }
    Ok(record)
}

/// Checks that a relation belongs to the patient and a payer patient exists.
pub(crate) async fn validate_payer_links(
    conn: &mut PgConnection,
    record: &PayerRecord,
    patient_id: Uuid,
) -> Result<Option<(&'static str, &'static str)>, sqlx::Error> {
    if let Some(relation_id) = record.payer_patient_relation_id {
        let belongs = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM patient_relations WHERE id = $1 AND patient_id = $2)",
        )
        .bind(relation_id)
        .bind(patient_id)
        .fetch_one(&mut *conn)
        .await?;
        if !belongs {
            return Ok(Some((
                "payer_relation_mismatch",
                "Payer relation does not belong to the patient",
            )));
        }
    }
    if let Some(payer_patient_id) = record.payer_patient_id {
        let exists =
            sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM patients WHERE id = $1)")
                .bind(payer_patient_id)
                .fetch_one(&mut *conn)
                .await?;
        if !exists {
            return Ok(Some(("payer_patient_not_found", "Payer patient not found")));
        }
    }
    Ok(None)
}

/// Carries a payer chosen for one patient over to an invoice of another
/// patient of the same family order. A relation is patient-scoped: a relative
/// with a patient record becomes that record, a relative without one becomes
/// a contact with the relation's name, e-mail, phone and address.
pub(crate) async fn adapt_payer_to_patient(
    conn: &mut PgConnection,
    mut record: PayerRecord,
    patient_id: Uuid,
) -> Result<PayerRecord, sqlx::Error> {
    if let Some(relation_id) = record.payer_patient_relation_id {
        let relation = sqlx::query(
            r#"SELECT patient_id, related_patient_id, related_name, relation_type, email, phone,
                      address_street, address_zip, address_city, address_country
               FROM patient_relations WHERE id = $1"#,
        )
        .bind(relation_id)
        .fetch_optional(&mut *conn)
        .await?;
        match relation {
            Some(row) if row.try_get::<Uuid, _>("patient_id")? == patient_id => {}
            Some(row) => {
                record.payer_patient_relation_id = None;
                let text = |column: &str| {
                    normalize_optional(
                        row.try_get::<Option<String>, _>(column)
                            .unwrap_or_default()
                            .as_deref(),
                    )
                };
                if !record.has_own_address() {
                    record.address_street = text("address_street");
                    record.address_zip = text("address_zip");
                    record.address_city = text("address_city");
                    record.address_country = text("address_country");
                }
                record.contact_email = record.contact_email.or_else(|| text("email"));
                match row.try_get::<Option<Uuid>, _>("related_patient_id")? {
                    Some(person) if person != patient_id => record.payer_patient_id = Some(person),
                    Some(_) => return Ok(PayerRecord::default()),
                    None => {
                        record.contact_name = record.contact_name.or_else(|| text("related_name"));
                        record.contact_phone = record.contact_phone.or_else(|| text("phone"));
                        record.contact_relationship = record
                            .contact_relationship
                            .or_else(|| text("relation_type"));
                    }
                }
            }
            None => record.payer_patient_relation_id = None,
        }
    }
    if record.payer_patient_id == Some(patient_id) {
        record.payer_patient_id = None;
    }
    if !record.is_set() {
        return Ok(PayerRecord::default());
    }
    Ok(record)
}

/// The payer a new invoice starts with, and where it came from.
#[derive(Clone, Debug, Default)]
pub struct InheritedPayer {
    pub record: PayerRecord,
    /// `head_order`, `order`, `default_payer`, `payer_declaration`,
    /// `contracting_party` or `none`.
    pub source: &'static str,
    /// A minor patient would receive the invoice: the creation answer warns
    /// and the release asks for confirmation.
    pub minor_without_payer: bool,
}

/// The payer a new invoice inherits (see the module documentation).
pub async fn inherited_invoice_payer(
    conn: &mut PgConnection,
    order_id: Option<Uuid>,
    patient_id: Uuid,
) -> Result<InheritedPayer, sqlx::Error> {
    if let Some(order_id) = order_id {
        let sql = format!(
            "SELECT {}, {} FROM orders o LEFT JOIN orders h ON h.id = o.head_order_id WHERE o.id = $1",
            payer_columns("o", "own_"),
            payer_columns("h", "head_"),
        );
        if let Some(row) = sqlx::query(&sql)
            .bind(order_id)
            .fetch_optional(&mut *conn)
            .await?
        {
            for (prefix, source) in [("head_", "head_order"), ("own_", "order")] {
                let record = PayerRecord::from_row(&row, prefix);
                if !record.is_set() {
                    continue;
                }
                let record = adapt_payer_to_patient(conn, record, patient_id).await?;
                if record.is_set() {
                    return Ok(InheritedPayer {
                        record,
                        source,
                        minor_without_payer: false,
                    });
                }
            }
        }
    }

    let party =
        contracting_party::resolve(conn, patient_id, order_id, None, crate::app_time::today())
            .await?;
    let default_relation = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM patient_relations WHERE patient_id = $1 AND is_default_payer",
    )
    .bind(patient_id)
    .fetch_optional(&mut *conn)
    .await?;
    if let Some(relation_id) = default_relation {
        let is_party = party.kind == PartyKind::LegalRepresentatives
            && party
                .representatives
                .iter()
                .any(|representative| representative.relation_id == relation_id);
        return Ok(InheritedPayer {
            record: PayerRecord {
                payer_patient_relation_id: Some(relation_id),
                payer_role: is_party.then(|| PAYER_ROLE_CONTRACTING_PARTY.to_string()),
                ..PayerRecord::default()
            },
            source: "default_payer",
            minor_without_payer: false,
        });
    }
    // The third party the patient's payer declaration names (the lead's
    // "Кто платит"), as a free-text contact with the declared address — the
    // record the declaration wrote on the lead's orders. A self-payer
    // declaration sets nothing; the steps below decide then.
    if let Some(declared) = lead_payer::patient_declaration(conn, patient_id).await?
        && let Some(record) = declared.declaration.order_payer_record(None)
    {
        return Ok(InheritedPayer {
            record,
            source: "payer_declaration",
            minor_without_payer: false,
        });
    }
    if party.kind == PartyKind::LegalRepresentatives
        && let Some(representative) = party.billing_representative()
    {
        return Ok(InheritedPayer {
            record: PayerRecord {
                payer_patient_relation_id: Some(representative.relation_id),
                payer_role: Some(PAYER_ROLE_CONTRACTING_PARTY.to_string()),
                ..PayerRecord::default()
            },
            source: "contracting_party",
            minor_without_payer: false,
        });
    }
    Ok(InheritedPayer {
        record: PayerRecord::default(),
        source: "none",
        minor_without_payer: party.patient_is_minor,
    })
}

/// Writes a payer onto an invoice inside the caller's transaction.
pub(crate) async fn store_invoice_payer(
    conn: &mut PgConnection,
    invoice_id: Uuid,
    record: &PayerRecord,
    actor_id: Option<Uuid>,
) -> Result<u64, sqlx::Error> {
    let updated = sqlx::query(
        r#"UPDATE invoices
           SET payer_patient_id = $2,
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
               payer_updated_by = COALESCE($14, payer_updated_by),
               payer_updated_at = CASE WHEN $14::uuid IS NULL THEN payer_updated_at ELSE now() END
           WHERE id = $1"#,
    )
    .bind(invoice_id)
    .bind(record.payer_patient_id)
    .bind(record.payer_patient_relation_id)
    .bind(&record.contact_name)
    .bind(&record.contact_email)
    .bind(&record.contact_phone)
    .bind(&record.contact_relationship)
    .bind(&record.notes)
    .bind(&record.address_street)
    .bind(&record.address_zip)
    .bind(&record.address_city)
    .bind(&record.address_country)
    .bind(&record.payer_role)
    .bind(actor_id)
    .execute(&mut *conn)
    .await?
    .rows_affected();
    if record.is_set() {
        hide_payer_invoice_from_minor_portal(conn, invoice_id).await?;
    }
    Ok(updated)
}

/// An invoice a third party pays is hidden from a minor patient's portal
/// unless staff already decided on its visibility (owner decision
/// 2026-10-01); adults see their invoices as before.
async fn hide_payer_invoice_from_minor_portal(
    conn: &mut PgConnection,
    invoice_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"UPDATE invoices invoice
           SET portal_visible = false,
               pdf_visible_to_patient = false,
               hide_amounts_from_patient = true
           FROM patients patient
           WHERE invoice.id = $1
             AND patient.id = invoice.patient_id
             AND invoice.visibility_updated_at IS NULL
             AND patient.birth_date > ($2::date - INTERVAL '18 years')"#,
    )
    .bind(invoice_id)
    .bind(crate::app_time::today())
    .execute(conn)
    .await
    .map(|_| ())
}

/// Confirmations a release may carry.
#[derive(Deserialize, Default, Clone, Copy, Debug)]
pub(crate) struct ReleaseConfirmations {
    /// Release an invoice addressed to a minor patient.
    #[serde(default)]
    pub confirm_minor_recipient: bool,
    /// Release an invoice addressed to someone other than the contracting
    /// party without marking the payer as Kostenübernehmer.
    #[serde(default)]
    pub confirm_recipient_not_party: bool,
    /// Release a final invoice whose advances went to another recipient.
    #[serde(default)]
    pub confirm_advance_recipient_mismatch: bool,
}

/// Why a release cannot go ahead (yet).
#[derive(Debug)]
pub(crate) enum ReleaseRecipientBlock {
    /// The recipient lacks name or postal address parts.
    Incomplete(Vec<&'static str>),
    /// A warning billing must confirm with `field`.
    NeedsConfirmation {
        code: &'static str,
        message: &'static str,
        field: &'static str,
        details: Value,
    },
    Database(sqlx::Error),
}

impl From<sqlx::Error> for ReleaseRecipientBlock {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(error)
    }
}

impl ReleaseRecipientBlock {
    pub fn into_response(self, invoice_id: Uuid) -> axum::response::Response {
        match self {
            Self::Incomplete(missing) => coded_err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "recipient_address_incomplete",
                "The invoice recipient needs a full name and postal address with country before release",
                json!({ "missing": missing }),
            ),
            Self::NeedsConfirmation {
                code,
                message,
                field,
                details,
            } => coded_err(
                StatusCode::CONFLICT,
                code,
                message,
                json!({ "confirm_field": field, "details": details }),
            ),
            Self::Database(error) => {
                tracing::error!(%error, %invoice_id, "check invoice recipient for release");
                err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to update invoice",
                )
            }
        }
    }
}

fn confirmation(actor_id: Uuid, at: &str) -> Value {
    json!({ "by": actor_id, "at": at })
}

/// Everything a release checks about the recipient of a draft.
struct RecipientEvaluation {
    live: Value,
    recipient: document::InvoiceRecipient,
    missing: Vec<&'static str>,
    party: ContractingParty,
    payer_role: Option<String>,
    /// A minor patient would receive the invoice.
    minor_recipient: bool,
    /// The recipient is the contracting party.
    is_party: bool,
    /// Released advances of the order billed to another recipient.
    mismatched_advances: Vec<Option<String>>,
}

impl RecipientEvaluation {
    /// Addressed to someone other than the party and not marked as
    /// Kostenübernehmer (a minor recipient is asked about separately).
    fn needs_party_confirmation(&self) -> bool {
        !self.is_party
            && !self.minor_recipient
            && self.payer_role.as_deref() != Some(PAYER_ROLE_COST_BEARER)
    }
}

async fn evaluate_recipient(
    conn: &mut PgConnection,
    invoice_id: Uuid,
) -> Result<RecipientEvaluation, sqlx::Error> {
    let row = sqlx::query(
        r#"SELECT invoice.patient_id, invoice.order_id, invoice.invoice_type, invoice.payer_role,
                  patient.birth_date
           FROM invoices invoice
           JOIN patients patient ON patient.id = invoice.patient_id
           WHERE invoice.id = $1"#,
    )
    .bind(invoice_id)
    .fetch_one(&mut *conn)
    .await?;
    let patient_id = row.try_get::<Uuid, _>("patient_id")?;
    let order_id = row.try_get::<Option<Uuid>, _>("order_id")?;
    let invoice_type = row.try_get::<String, _>("invoice_type")?;
    let payer_role = row.try_get::<Option<String>, _>("payer_role")?;
    let birth_date = row.try_get::<Option<NaiveDate>, _>("birth_date")?;

    let live = document::resolve_live_recipient(conn, invoice_id).await?;
    let recipient = document::InvoiceRecipient::from_json(&live, false);
    let missing = document::missing_address_parts(&recipient);
    let today = crate::app_time::today();
    let party = contracting_party::resolve(conn, patient_id, order_id, None, today).await?;
    let minor_recipient = recipient.kind == "patient" && is_minor_on(birth_date, today);
    let is_party = party.is_recipient(&live);
    let mismatched_advances = match (invoice_type.as_str(), order_id) {
        ("final", Some(order_id)) => {
            sqlx::query_scalar::<_, Option<String>>(
                r#"SELECT advance.invoice_number
                   FROM invoices advance
                   WHERE advance.order_id = $1
                     AND advance.patient_id = $2
                     AND advance.invoice_type = 'advance'
                     AND advance.released_at IS NOT NULL
                     AND advance.status <> 'cancelled'
                     AND invoice_recipient_identity(advance.recipient_snapshot)
                         IS DISTINCT FROM invoice_recipient_identity($3::jsonb)
                   ORDER BY advance.issued_at, advance.id"#,
            )
            .bind(order_id)
            .bind(patient_id)
            .bind(&live)
            .fetch_all(&mut *conn)
            .await?
        }
        _ => Vec::new(),
    };
    Ok(RecipientEvaluation {
        live,
        recipient,
        missing,
        party,
        payer_role,
        minor_recipient,
        is_party,
        mismatched_advances,
    })
}

/// What the release of a draft will check, for the invoice detail: shown as
/// warnings before billing presses "release".
pub(crate) async fn draft_release_checks(
    conn: &mut PgConnection,
    invoice_id: Uuid,
    _viewer: Uuid,
) -> Result<Value, sqlx::Error> {
    let evaluation = evaluate_recipient(conn, invoice_id).await?;
    let mut warnings = Vec::new();
    if !evaluation.missing.is_empty() {
        warnings.push(json!({
            "code": "recipient_address_incomplete",
            "missing": evaluation.missing,
        }));
    }
    if evaluation.minor_recipient {
        warnings.push(json!({ "code": "minor_patient_recipient" }));
    }
    if evaluation.needs_party_confirmation() {
        warnings.push(json!({ "code": "recipient_not_contracting_party" }));
    }
    if !evaluation.mismatched_advances.is_empty() {
        warnings.push(json!({
            "code": "advance_recipient_mismatch",
            "advance_invoice_numbers": evaluation.mismatched_advances,
        }));
    }
    Ok(json!({
        "warnings": warnings,
        "contracting_party": party_summary(&evaluation.party),
        "recipient_is_contracting_party": evaluation.is_party,
    }))
}

/// Validates the recipient of a draft about to be released and builds the
/// snapshot the release freezes. Runs inside the releasing transaction after
/// the invoice row is locked.
pub(crate) async fn release_recipient_snapshot(
    conn: &mut PgConnection,
    invoice_id: Uuid,
    confirmations: ReleaseConfirmations,
    actor_id: Uuid,
) -> Result<Value, ReleaseRecipientBlock> {
    let evaluation = evaluate_recipient(conn, invoice_id).await?;
    if !evaluation.missing.is_empty() {
        return Err(ReleaseRecipientBlock::Incomplete(evaluation.missing));
    }
    let now = Utc::now().to_rfc3339();
    let mut confirmed = Map::new();

    if evaluation.minor_recipient {
        if !confirmations.confirm_minor_recipient {
            return Err(ReleaseRecipientBlock::NeedsConfirmation {
                code: "minor_patient_recipient",
                message: "The invoice is addressed to a minor patient; set the payer (e.g. a parent) or confirm",
                field: "confirm_minor_recipient",
                details: json!({ "contracting_party": party_summary(&evaluation.party) }),
            });
        }
        confirmed.insert(
            "minor_patient_recipient".into(),
            confirmation(actor_id, &now),
        );
    }

    if evaluation.needs_party_confirmation() {
        if !confirmations.confirm_recipient_not_party {
            return Err(ReleaseRecipientBlock::NeedsConfirmation {
                code: "recipient_not_contracting_party",
                message: "The invoice recipient is not the contracting party; mark the payer as cost bearer or confirm",
                field: "confirm_recipient_not_party",
                details: json!({
                    "recipient_name": evaluation.recipient.name,
                    "contracting_party": party_summary(&evaluation.party),
                }),
            });
        }
        confirmed.insert(
            "recipient_not_contracting_party".into(),
            confirmation(actor_id, &now),
        );
    }

    if !evaluation.mismatched_advances.is_empty() {
        if !confirmations.confirm_advance_recipient_mismatch {
            return Err(ReleaseRecipientBlock::NeedsConfirmation {
                code: "advance_recipient_mismatch",
                message: "Advance invoices of this order went to another recipient; the final invoice deducts advances of the same recipient only",
                field: "confirm_advance_recipient_mismatch",
                details: json!({ "advance_invoice_numbers": evaluation.mismatched_advances }),
            });
        }
        confirmed.insert(
            "advance_recipient_mismatch".into(),
            json!({
                "by": actor_id,
                "at": now,
                "advance_invoice_numbers": evaluation.mismatched_advances,
            }),
        );
    }

    let mut snapshot = match evaluation.live {
        Value::Object(map) => map,
        _ => Map::new(),
    };
    snapshot.insert(
        "service_recipient_name".into(),
        if evaluation.is_party {
            Value::Null
        } else {
            json!(evaluation.party.debtor_name())
        },
    );
    snapshot.insert("contracting_party".into(), party_summary(&evaluation.party));
    snapshot.insert("payer_role".into(), json!(evaluation.payer_role));
    snapshot.insert("confirmations".into(), Value::Object(confirmed));
    snapshot.insert("captured".into(), json!("release"));
    snapshot.insert("captured_at".into(), json!(now));
    snapshot.insert("captured_by".into(), json!(actor_id));
    Ok(Value::Object(snapshot))
}

/// The contracting party as kept in a snapshot or shown in a warning: kind
/// and names only (data minimisation).
pub(crate) fn party_summary(party: &ContractingParty) -> Value {
    json!({
        "kind": party.kind.as_str(),
        "explicit": party.explicit,
        "debtor_name": party.debtor_name(),
        "patient_is_minor": party.patient_is_minor,
        "representatives": party.representatives.iter().map(|representative| json!({
            "relation_id": representative.relation_id,
            "name": representative.name,
        })).collect::<Vec<_>>(),
    })
}

/// `POST /invoices/{id}/payer`: sets the payer of a draft invoice. The row is
/// locked, so a concurrent release either sees the new payer or makes this
/// request fail; the audit row (old and new payer) commits with the change.
pub(crate) async fn update_invoice_payer(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(invoice_id): Path<Uuid>,
    Json(mut body): Json<PayerInput>,
) -> axum::response::Response {
    const FAILED: &str = "Failed to update invoice payer";
    if !auth.can(Capability::InvoicesPayer) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }
    if let Err(error) = body.resolve_patient_pid(&state.db).await {
        return payer_pid_error(error);
    }
    let patient_id =
        match sqlx::query_scalar::<_, Uuid>("SELECT patient_id FROM invoices WHERE id = $1")
            .bind(invoice_id)
            .fetch_optional(&state.db)
            .await
        {
            Ok(Some(patient_id)) => patient_id,
            Ok(None) => return err(StatusCode::NOT_FOUND, "Invoice not found"),
            Err(error) => {
                tracing::error!(%error, %invoice_id, "load invoice payer context");
                return err(StatusCode::INTERNAL_SERVER_ERROR, FAILED);
            }
        };
    if let Err(response) = ensure_patient_access(&state, &auth, patient_id).await {
        return response;
    }
    let record = match payer_from_input(&body, Some(patient_id)) {
        Ok(record) => record,
        Err((code, message)) => {
            return coded_err(StatusCode::UNPROCESSABLE_ENTITY, code, message, json!({}));
        }
    };
    if let Some(payer_patient_id) = record.payer_patient_id
        && let Err(response) = ensure_patient_access(&state, &auth, payer_patient_id).await
    {
        return response;
    }

    let mut transaction = match state.db.begin().await {
        Ok(transaction) => transaction,
        Err(error) => {
            tracing::error!(%error, %invoice_id, "begin invoice payer transaction");
            return err(StatusCode::INTERNAL_SERVER_ERROR, FAILED);
        }
    };
    let sql = format!(
        "SELECT i.patient_id, i.released_at IS NOT NULL AS released, {} FROM invoices i WHERE i.id = $1 FOR UPDATE",
        payer_columns("i", "")
    );
    let locked = match sqlx::query(&sql)
        .bind(invoice_id)
        .fetch_optional(&mut *transaction)
        .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Invoice not found"),
        Err(error) => {
            tracing::error!(%error, %invoice_id, "lock invoice payer");
            return err(StatusCode::INTERNAL_SERVER_ERROR, FAILED);
        }
    };
    if locked.try_get::<Uuid, _>("patient_id").ok() != Some(patient_id) {
        return err(
            StatusCode::CONFLICT,
            "Invoice changed; reload and try again",
        );
    }
    // The recipient is part of the issued document (§ 14 UStG, GoBD).
    if locked.try_get::<bool, _>("released").unwrap_or(false) {
        return err(
            StatusCode::CONFLICT,
            "The payer of a released invoice cannot change; cancel the invoice and issue a new one",
        );
    }
    match validate_payer_links(&mut transaction, &record, patient_id).await {
        Ok(None) => {}
        Ok(Some((code, message))) => {
            return coded_err(StatusCode::UNPROCESSABLE_ENTITY, code, message, json!({}));
        }
        Err(error) => {
            tracing::error!(%error, %invoice_id, "validate invoice payer");
            return err(StatusCode::INTERNAL_SERVER_ERROR, FAILED);
        }
    }
    let previous = PayerRecord::from_row(&locked, "");
    if let Err(error) =
        store_invoice_payer(&mut transaction, invoice_id, &record, Some(auth.user_id)).await
    {
        tracing::error!(%error, %invoice_id, "update invoice payer");
        return err(StatusCode::INTERNAL_SERVER_ERROR, FAILED);
    }
    let mut event = audit::domain_diff_event(
        "payer_assigned",
        Some(auth.user_id),
        "invoice",
        Some(invoice_id),
        previous.to_audit_json(),
        record.to_audit_json(),
    );
    event.context = json!({ "patient_id": patient_id });
    if let Err(error) = audit::write_in_transaction(&mut transaction, &event).await {
        tracing::error!(%error, %invoice_id, "audit invoice payer");
        return err(StatusCode::INTERNAL_SERVER_ERROR, FAILED);
    }
    if let Err(error) = transaction.commit().await {
        tracing::error!(%error, %invoice_id, "commit invoice payer");
        return err(StatusCode::INTERNAL_SERVER_ERROR, FAILED);
    }

    crate::realtime::publish_invoice_event(
        &state,
        Some(auth.user_id),
        "invoice.payer_changed",
        invoice_id,
        json!({
            "patient_id": patient_id,
            "payer_patient_relation_id": record.payer_patient_relation_id,
            "payer_patient_id": record.payer_patient_id,
        }),
    )
    .await;

    match load_invoice_detail(&state, invoice_id, &auth).await {
        Ok(Some(invoice)) => Json(invoice).into_response(),
        Ok(None) => err(StatusCode::NOT_FOUND, "Invoice not found"),
        Err(response) => response,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn email_plausibility_rejects_obvious_typos() {
        assert!(is_plausible_email("max.muster@example.test"));
        assert!(!is_plausible_email("max.muster@example"));
        assert!(!is_plausible_email("max muster@example.test"));
        assert!(!is_plausible_email("@example.test"));
        assert!(!is_plausible_email("max@@example.test"));
        assert!(!is_plausible_email("max@example.test."));
    }

    #[test]
    fn payer_input_is_normalized_and_validated() {
        let patient = Uuid::new_v4();
        let record = payer_from_input(
            &PayerInput {
                payer_contact_name: Some("  Ivan Zahler ".into()),
                payer_contact_email: Some(" ivan@example.test ".into()),
                payer_address_city: Some(" ".into()),
                payer_role: Some("cost_bearer".into()),
                ..PayerInput::default()
            },
            Some(patient),
        )
        .unwrap();
        assert_eq!(record.contact_name.as_deref(), Some("Ivan Zahler"));
        assert_eq!(record.contact_email.as_deref(), Some("ivan@example.test"));
        assert_eq!(record.address_city, None);

        let cleared = payer_from_input(
            &PayerInput {
                payer_notes: Some("left over".into()),
                payer_role: Some("cost_bearer".into()),
                ..PayerInput::default()
            },
            Some(patient),
        )
        .unwrap();
        assert_eq!(cleared, PayerRecord::default());

        for (input, code) in [
            (
                PayerInput {
                    payer_contact_name: Some("Ivan".into()),
                    payer_contact_email: Some("ivan@".into()),
                    ..PayerInput::default()
                },
                "payer_email_invalid",
            ),
            (
                PayerInput {
                    payer_patient_id: Some(Uuid::new_v4()),
                    payer_patient_relation_id: Some(Uuid::new_v4()),
                    ..PayerInput::default()
                },
                "payer_single_record",
            ),
            (
                PayerInput {
                    payer_patient_id: Some(patient),
                    ..PayerInput::default()
                },
                "payer_is_patient",
            ),
            (
                PayerInput {
                    payer_contact_name: Some("Ivan".into()),
                    payer_role: Some("guarantor".into()),
                    ..PayerInput::default()
                },
                "payer_role_invalid",
            ),
        ] {
            assert_eq!(payer_from_input(&input, Some(patient)).unwrap_err().0, code);
        }
    }
}
