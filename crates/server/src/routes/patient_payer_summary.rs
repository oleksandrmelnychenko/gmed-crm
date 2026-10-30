//! "Плательщик" on the patient card (owner request 2026-10-06): who pays for
//! the patient, as declared in the lead cabinet or by staff, and whom an
//! invoice would be addressed to today.
//!
//! One read endpoint keyed by the patient, `GET /patients/{id}/payer-summary`.
//! Nothing is stored; the answer is computed from
//! - the payer declaration of the most recently converted lead of the patient
//!   ([`lead_payer::patient_declaration`]),
//! - the contracting party of the patient ([`contracting_party::resolve`]),
//! - the payer a new invoice would inherit today
//!   ([`inherited_invoice_payer`], resolved by `invoice_recipient_resolve`
//!   like a draft's recipient), and
//! - for the roles that read a lead's payer declaration, the identification
//!   status of that lead ([`lead_identification::load_identification_status`]).
//!
//! The lead-keyed endpoints are not for the card: Billing may not call them,
//! a patient may have several converted leads, and the evidence of a
//! converted lead lives among the patient's documents. The GwG answers (own
//! account, beneficial owner, source of funds, citizenships, date and place of
//! birth) are returned to nobody; they stay in the lead wizard. Of the
//! lead's form the card shows section 7 — where the invoice goes, the other
//! address, the e-mail for invoices, the USt-IdNr. and Steuernummer staff
//! added (`Declaration::billing_json`) — to every viewer of the card; the
//! payment route (section 8) is compliance evidence and never part of the
//! answer. The recipient's `source` and `role` may read `invoice_address`:
//! the party at the other address the lead named.
//!
//! Access: `invoices.view` and access to the patient's financials
//! ([`patient_financials::ensure_patient_access`]); `identification` only for
//! [`lead_payer::may_view`], `null` for Billing. See
//! `docs/architecture/lead-payer-declaration_ua.md`.

use axum::{
    Json, Router,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
};
use chrono::{DateTime, Utc};
use serde_json::{Value, json};
use sqlx::{PgConnection, Row};
use uuid::Uuid;

use crate::auth::middleware::AuthUser;
use crate::routes::invoices::payer::{
    InheritedPayer, InvoiceRecipient, add_declared_recipient_details, inherited_invoice_payer,
    missing_address_parts,
};
use crate::routes::lead_identification::{self, IdentificationStatus};
use crate::routes::lead_payer::{self, PatientDeclaration};
use crate::routes::patient_financials;
use crate::services::contracting_party::{self, ContractingParty};
use crate::state::AppState;
use gmed_domain::access::capabilities::Capability;

pub fn router() -> Router<AppState> {
    Router::new().route(
        "/patients/{patient_id}/payer-summary",
        get(get_patient_payer_summary),
    )
}

/// Whom an invoice of the patient would be addressed to today: the payer a
/// new invoice inherits, resolved to a recipient.
struct RecipientSummary {
    inherited: InheritedPayer,
    recipient: InvoiceRecipient,
    /// The relation or the patient record the recipient was resolved from,
    /// as `invoice_recipient_resolve` names them.
    payer_patient_relation_id: Option<Uuid>,
    payer_patient_id: Option<Uuid>,
    /// Who entered the lead's answer the recipient comes from (`source`
    /// `payer_declaration` or `invoice_address`): `self` / `guardian` in the
    /// cabinet, `staff` in the client's form or the wizard (owner 2026-10-30).
    entered_by: Option<&'static str>,
}

impl RecipientSummary {
    fn to_json(&self) -> Value {
        let mut value = json!({
            "source": self.inherited.source,
            "role": self.inherited.record.payer_role,
            "kind": self.recipient.kind,
            "name": self.recipient.name,
            "street": self.recipient.street,
            "zip": self.recipient.zip,
            "city": self.recipient.city,
            "country": self.recipient.country,
            "email": self.recipient.email,
            "vat_id": self.recipient.vat_id,
            "tax_number": self.recipient.tax_number,
            "payer_patient_relation_id": self.payer_patient_relation_id,
            "payer_patient_id": self.payer_patient_id,
            "missing": missing_address_parts(&self.recipient),
            "minor_without_payer": self.inherited.minor_without_payer,
        });
        // Only for a recipient that comes from the lead's answers.
        if let Some(entered_by) = self.entered_by {
            value["entered_by"] = json!(entered_by);
        }
        value
    }
}

/// An open lead of the patient (a repeat request, or the request the
/// prospect was made for): the payer of that request is declared there.
struct OpenRequest {
    lead_id: Uuid,
    has_declaration: bool,
}

/// Everything the card shows.
struct PayerSummary {
    patient_id: Uuid,
    declared: Option<PatientDeclaration>,
    party: ContractingParty,
    recipient: RecipientSummary,
    identification: Option<IdentificationStatus>,
    open_request: Option<OpenRequest>,
}

impl PayerSummary {
    fn to_json(&self) -> Value {
        let rfc3339 = |at: DateTime<Utc>| at.to_rfc3339();
        json!({
            "patient_id": self.patient_id,
            "patient_is_minor": self.party.patient_is_minor,
            "source": self.declared.as_ref().map(|declared| json!({
                "lead_id": declared.lead_id,
                "converted_at": rfc3339(declared.converted_at),
                "declared_at": declared.declared_at.map(rfc3339),
            })),
            "declaration": self
                .declared
                .as_ref()
                .map(|declared| declared.declaration.billing_json()),
            "contracting_party": self.party.to_json(),
            "invoice_recipient": self.recipient.to_json(),
            "identification": self
                .identification
                .as_ref()
                .map(IdentificationStatus::to_json),
            "open_request": self.open_request.as_ref().map(|request| json!({
                "lead_id": request.lead_id,
                "has_declaration": request.has_declaration,
            })),
        })
    }
}

/// The payer a new invoice of the patient inherits today, resolved like a
/// draft's recipient (name, address and e-mail of the relation, the patient
/// record or the contact; the patient's own when nobody else pays).
async fn load_recipient(
    conn: &mut PgConnection,
    patient_id: Uuid,
) -> Result<RecipientSummary, sqlx::Error> {
    let inherited = inherited_invoice_payer(conn, None, patient_id).await?;
    let record = &inherited.record;
    let mut resolved = sqlx::query_scalar::<_, Option<Value>>(
        "SELECT invoice_recipient_resolve($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    )
    .bind(patient_id)
    .bind(record.payer_patient_id)
    .bind(record.payer_patient_relation_id)
    .bind(&record.contact_name)
    .bind(&record.contact_email)
    .bind(&record.address_street)
    .bind(&record.address_zip)
    .bind(&record.address_city)
    .bind(&record.address_country)
    .fetch_one(&mut *conn)
    .await?
    .unwrap_or(Value::Null);
    // The e-mail for invoices and the tax numbers of section 7, as a draft
    // of the patient would carry them.
    add_declared_recipient_details(conn, &mut resolved, patient_id, None).await?;
    let uuid = |key: &str| {
        resolved
            .get(key)
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
    };
    Ok(RecipientSummary {
        payer_patient_relation_id: uuid("payer_patient_relation_id"),
        payer_patient_id: uuid("payer_patient_id"),
        recipient: InvoiceRecipient::from_json(&resolved, false),
        inherited,
        entered_by: None,
    })
}

/// Who entered the part of the lead's form an inherited recipient comes from:
/// the invoice recipient of step 3 for `invoice_address`, the payer for
/// `payer_declaration`. The cabinet's marker names its writer; without one
/// staff entered it in the wizard. `None` for the other sources.
async fn recipient_entered_by(
    conn: &mut PgConnection,
    lead_id: Uuid,
    source: &str,
) -> Result<Option<&'static str>, sqlx::Error> {
    let marker = match source {
        "invoice_address" => crate::routes::lead_portal_intake::INVOICE_RECIPIENT_MARKER,
        "payer_declaration" => crate::routes::lead_portal_intake::PAYER_MARKER,
        _ => return Ok(None),
    };
    let row = sqlx::query(
        r#"SELECT COALESCE(portal_field_updates ? $2, false) AS has_marker,
                  portal_field_updates -> $2 ->> 'kind' AS kind
           FROM leads WHERE id = $1"#,
    )
    .bind(lead_id)
    .bind(marker)
    .fetch_optional(&mut *conn)
    .await?;
    Ok(row.map(|row| {
        entered_by_of_marker(
            row.try_get::<bool, _>("has_marker").unwrap_or(false),
            row.try_get::<Option<String>, _>("kind")
                .ok()
                .flatten()
                .as_deref(),
        )
    }))
}

/// The writer of a cabinet marker: staff without one (the wizard); a marker
/// without a kind is older than staff filling in the client's form, so the
/// client's own.
fn entered_by_of_marker(has_marker: bool, kind: Option<&str>) -> &'static str {
    match (has_marker, kind) {
        (false, _) | (true, Some("staff")) => "staff",
        (true, Some("guardian")) => "guardian",
        (true, _) => "self",
    }
}

/// The newest open lead of the patient, if any.
async fn load_open_request(
    conn: &mut PgConnection,
    patient_id: Uuid,
) -> Result<Option<OpenRequest>, sqlx::Error> {
    let row = sqlx::query(
        r#"SELECT l.id,
                  EXISTS(SELECT 1 FROM lead_payer_declarations d WHERE d.lead_id = l.id)
                      AS has_declaration
           FROM leads l
           WHERE (l.repeat_patient_id = $1 OR l.prospect_patient_id = $1)
             AND l.converted_patient_id IS NULL
             AND COALESCE(l.failed_outcome_status, 'none') = 'none'
           ORDER BY l.created_at DESC, l.id DESC
           LIMIT 1"#,
    )
    .bind(patient_id)
    .fetch_optional(conn)
    .await?;
    Ok(row.map(|row| OpenRequest {
        lead_id: row.try_get("id").unwrap_or_default(),
        has_declaration: row.try_get("has_declaration").unwrap_or(false),
    }))
}

/// Loads the summary of a patient. `with_identification` adds the
/// identification status of the declaration's lead (the readers of the
/// lead's payer declaration only).
async fn load_summary(
    conn: &mut PgConnection,
    patient_id: Uuid,
    with_identification: bool,
) -> Result<PayerSummary, sqlx::Error> {
    let mut party =
        contracting_party::resolve(conn, patient_id, None, None, crate::app_time::today()).await?;
    // The card names the party of the signed contract: the paying parent
    // alone when the lead's cabinet named one (map 94, QA 2026-10-25 R-5).
    crate::routes::documents::narrow_patient_party_to_paying_parent(conn, patient_id, &mut party)
        .await?;
    let mut declared = lead_payer::patient_declaration(conn, patient_id).await?;
    // A parent named as payer (owner decision 2026-10-19) is shown with the
    // representative's data, as of the conversion day.
    if let Some(declared) = declared
        .as_mut()
        .filter(|declared| declared.declaration.is_representative())
    {
        let on = crate::app_time::date_of(declared.converted_at);
        if let Some(loaded) =
            crate::routes::lead_representatives::load_on(conn, declared.lead_id, on).await?
        {
            declared.declaration = declared
                .declaration
                .with_representative(&loaded.representation);
        }
    }
    let mut recipient = load_recipient(conn, patient_id).await?;
    if let Some(declared) = &declared {
        recipient.entered_by =
            recipient_entered_by(conn, declared.lead_id, recipient.inherited.source).await?;
    }
    let identification = match (&declared, with_identification) {
        (Some(declared), true) => {
            Some(lead_identification::load_identification_status(conn, declared.lead_id).await?)
        }
        _ => None,
    };
    let open_request = load_open_request(conn, patient_id).await?;
    Ok(PayerSummary {
        patient_id,
        declared,
        party,
        recipient,
        identification,
        open_request,
    })
}

fn error(status: StatusCode, code: &str, message: &str) -> Response {
    (status, Json(json!({"error": code, "message": message}))).into_response()
}

fn database_error(error: sqlx::Error, context: &'static str) -> Response {
    tracing::error!(%error, context, "patient payer summary");
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({"error": "Internal Server Error", "message": "Failed to load the payer summary"})),
    )
        .into_response()
}

/// `GET /patients/{id}/payer-summary`: the roles that see the patient's
/// invoices (`invoices.view`) with access to the patient's financials; the
/// identification labels only for the readers of the lead's declaration.
async fn get_patient_payer_summary(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_id): Path<Uuid>,
) -> Response {
    if !auth.can(Capability::InvoicesView) {
        return error(
            StatusCode::FORBIDDEN,
            "forbidden",
            "Insufficient permissions",
        );
    }
    if let Err(response) =
        patient_financials::ensure_patient_access(&state, &auth, patient_id).await
    {
        return response;
    }
    let mut conn = match state.db.acquire().await {
        Ok(conn) => conn,
        Err(error) => return database_error(error, "acquire payer summary"),
    };
    match sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM patients WHERE id = $1)")
        .bind(patient_id)
        .fetch_one(&mut *conn)
        .await
    {
        Ok(true) => {}
        Ok(false) => return error(StatusCode::NOT_FOUND, "not_found", "Patient not found"),
        Err(error) => return database_error(error, "load payer summary patient"),
    }
    match load_summary(&mut conn, patient_id, lead_payer::may_view(&auth)).await {
        Ok(summary) => Json(summary.to_json()).into_response(),
        Err(error) => database_error(error, "load payer summary"),
    }
}
