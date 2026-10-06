//! The payer's signature package (owner decisions 2026-10-06, phase 3b).
//!
//! A third-party payer signs ONE package of four documents electronically
//! (Skribble), with a qualified electronic signature (QES), which also
//! identifies the payer under the GwG:
//!
//! 1. `self_disclosure` — "Selbstauskunft der zahlenden Person"
//!    (`payer_self_disclosure`), the payer's own answers;
//! 2. `cost_coverage` — the Kostenübernahmeerklärung
//!    (`cost_coverage_declaration`);
//! 3. `patient_statement` — "Erklärung zur Kostenübernahme durch Dritte"
//!    (`patient_payer_statement`), what the patient side said about the payer;
//! 4. `cost_estimate` — the payer's copy of the client's Kostenvoranschlag
//!    (`payer_cost_estimate`): service types and amounts only, never a line
//!    text, a diagnosis, a treatment, a clinic or a doctor, and without the
//!    medical cost calculation.
//!
//! Staff prepare the package (`prepare`: fresh versions of the four
//! documents, recorded with what they were made from) and send it (`send`:
//! one signature request with the payer and GMED's default signers, level
//! QES). The package goes out only after the payer sent its answers (phase
//! 3a), with the patient's consent to pass the cost estimate on, a lead order
//! and the client's current cost estimate. A later change makes the package
//! `outdated`; nothing is withdrawn automatically. Completion needs no write
//! of its own: the Kostenübernahmeerklärung is marked signed by the signature
//! effects, the identification is derived, the status is read from the
//! request. The payer sees one status line (`payer_view`). See
//! docs/architecture/lead-payer-declaration_ua.md («Пакет підписів платника
//! (фаза 3b)»).

use axum::{
    Json, Router,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use chrono::{DateTime, SecondsFormat, SubsecRound, Utc};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{PgConnection, Postgres, Row, Transaction};
use uuid::Uuid;

use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::document_signatures::{self, FixedPackage, provider::Signer};
use crate::routes::documents::{LeadDocumentGeneration, generate_lead_document};
use crate::routes::lead_payer::{self, Declaration, PayerReason, PayerState};
use crate::routes::lead_payer_link::{self, PackageSubject};
use crate::routes::lead_portal_intake as intake;
use crate::routes::{lead_identification, lead_representatives};
use crate::state::AppState;
use gmed_domain::role::Role;

/// The four documents of the package in bundle order: the slot key of the
/// API and the template.
const SLOTS: [(&str, &str); 4] = [
    ("self_disclosure", "payer_self_disclosure"),
    ("cost_coverage", "cost_coverage_declaration"),
    ("patient_statement", "patient_payer_statement"),
    ("cost_estimate", "payer_cost_estimate"),
];

/// The slots generated for the lead's order (the others belong to the lead).
fn slot_needs_order(template: &str) -> bool {
    matches!(
        template,
        "cost_coverage_declaration" | "payer_cost_estimate"
    )
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/leads/{lead_id}/payer-signature-package", get(get_package))
        .route(
            "/leads/{lead_id}/payer-signature-package/prepare",
            post(prepare),
        )
        .route("/leads/{lead_id}/payer-signature-package/send", post(send))
        .route(
            "/me/lead-requests/{lead_id}/payer/cost-estimate-consent",
            post(cost_estimate_consent),
        )
}

// ----------------------------------------------------------------------------
// Errors
// ----------------------------------------------------------------------------

/// `{ "error": code, "code": code, "message", …extra }`.
fn refuse(status: StatusCode, code: &str, message: &str, extra: Value) -> Response {
    let mut body = json!({ "error": code, "code": code, "message": message });
    if let (Some(body), Some(extra)) = (body.as_object_mut(), extra.as_object()) {
        for (key, value) in extra {
            body.insert(key.clone(), value.clone());
        }
    }
    (status, Json(body)).into_response()
}

fn database(error: sqlx::Error, context: &'static str) -> Response {
    tracing::error!(%error, context, "lead payer signature package");
    refuse(
        StatusCode::INTERNAL_SERVER_ERROR,
        "internal_error",
        "Failed to load the payer's signature package",
        json!({}),
    )
}

fn blocked_message(reason: &str) -> &'static str {
    match reason {
        "lead_converted" => "The lead is converted",
        "lead_deleted" => "The lead is deleted",
        "no_third_party" => "No third party pays",
        "payer_not_submitted" => "The payer has not sent its answers yet",
        "payer_declaration_incomplete" => "The payer declaration is incomplete",
        "cost_estimate_consent_missing" => {
            "The patient has not agreed that the cost estimate is passed on to the payer"
        }
        "order_missing" => "The lead has no order",
        "cost_estimate_missing" => "The order has no current cost estimate",
        "payer_signer_incomplete" => "The signer's name or e-mail address is missing",
        "payer_documents_pending" => "A document of the package is out for signature elsewhere",
        _ => "The package cannot be prepared now",
    }
}

/// CEO and patient manager prepare and send; the other readers only look.
fn may_send(auth: &AuthUser) -> bool {
    matches!(auth.role, Role::Ceo | Role::PatientManager)
}

// ----------------------------------------------------------------------------
// State
// ----------------------------------------------------------------------------

/// The non-superseded package of a lead.
struct PackageRow {
    id: Uuid,
    mode: String,
    signer_first_name: String,
    signer_last_name: String,
    signer_email: String,
    acting_for: Option<String>,
    statement_submitted_at: DateTime<Utc>,
    payer_identity_changed_at: DateTime<Utc>,
    patient_statement_fingerprint: String,
    cost_estimate_document_id: Option<Uuid>,
    documents: [Option<Uuid>; 4],
    prepared_at: DateTime<Utc>,
    prepared_by_name: Option<String>,
    request_id: Option<Uuid>,
    sent_at: Option<DateTime<Utc>>,
    sent_by_name: Option<String>,
    language: Option<String>,
}

const PACKAGE_SELECT: &str = r#"SELECT p.id, p.mode, p.signer_first_name, p.signer_last_name,
           p.signer_email, p.acting_for, p.statement_submitted_at, p.payer_identity_changed_at,
           p.patient_statement_fingerprint, p.cost_estimate_document_id,
           p.self_disclosure_document_id, p.cost_coverage_document_id,
           p.patient_statement_document_id, p.payer_cost_estimate_document_id,
           p.prepared_at, preparer.name AS prepared_by_name, p.request_id, p.sent_at,
           sender.name AS sent_by_name, p.language
       FROM lead_payer_signature_packages p
       LEFT JOIN users preparer ON preparer.id = p.prepared_by
       LEFT JOIN users sender ON sender.id = p.sent_by
       WHERE p.lead_id = $1 AND p.superseded_at IS NULL"#;

impl PackageRow {
    fn from_row(row: &sqlx::postgres::PgRow) -> Result<Self, sqlx::Error> {
        Ok(Self {
            id: row.try_get("id")?,
            mode: row.try_get("mode")?,
            signer_first_name: row.try_get("signer_first_name")?,
            signer_last_name: row.try_get("signer_last_name")?,
            signer_email: row.try_get("signer_email")?,
            acting_for: row.try_get("acting_for")?,
            statement_submitted_at: row.try_get("statement_submitted_at")?,
            payer_identity_changed_at: row.try_get("payer_identity_changed_at")?,
            patient_statement_fingerprint: row.try_get("patient_statement_fingerprint")?,
            cost_estimate_document_id: row.try_get("cost_estimate_document_id")?,
            documents: [
                row.try_get("self_disclosure_document_id")?,
                row.try_get("cost_coverage_document_id")?,
                row.try_get("patient_statement_document_id")?,
                row.try_get("payer_cost_estimate_document_id")?,
            ],
            prepared_at: row.try_get("prepared_at")?,
            prepared_by_name: row.try_get("prepared_by_name")?,
            request_id: row.try_get("request_id")?,
            sent_at: row.try_get("sent_at")?,
            sent_by_name: row.try_get("sent_by_name")?,
            language: row.try_get("language")?,
        })
    }
}

async fn load_package(
    conn: &mut PgConnection,
    lead_id: Uuid,
) -> Result<Option<PackageRow>, sqlx::Error> {
    sqlx::query(PACKAGE_SELECT)
        .bind(lead_id)
        .fetch_optional(&mut *conn)
        .await?
        .as_ref()
        .map(PackageRow::from_row)
        .transpose()
}

/// The signature request of a package.
struct RequestFacts {
    status: String,
    test_mode: bool,
    signed_at: Option<DateTime<Utc>>,
}

async fn load_request(
    conn: &mut PgConnection,
    request_id: Option<Uuid>,
) -> Result<Option<RequestFacts>, sqlx::Error> {
    let Some(request_id) = request_id else {
        return Ok(None);
    };
    let row = sqlx::query(
        "SELECT status, test_mode, signed_at FROM document_signature_requests WHERE id = $1",
    )
    .bind(request_id)
    .fetch_optional(&mut *conn)
    .await?;
    row.map(|row| {
        Ok(RequestFacts {
            status: row.try_get("status")?,
            test_mode: row.try_get("test_mode")?,
            signed_at: row.try_get("signed_at")?,
        })
    })
    .transpose()
}

/// The package status the API shows, from its request: `prepared` before it
/// was sent.
fn package_status(request: Option<&RequestFacts>) -> &'static str {
    match request.map(|request| request.status.as_str()) {
        None => "prepared",
        Some("submitting" | "submission_unknown") => "sending",
        Some("pending") => "pending",
        Some("completed") => "signed",
        Some("needs_review") => "needs_review",
        Some("declined") => "declined",
        Some("withdrawn") => "withdrawn",
        Some("expired") => "expired",
        Some(_) => "error",
    }
}

/// One document of the package as stored now.
struct SlotDocument {
    id: Uuid,
    title: String,
    version: i32,
    signed_at: Option<DateTime<Utc>>,
    /// Still the latest version, not archived, the file not deleted.
    current: bool,
}

async fn load_slot_documents(
    conn: &mut PgConnection,
    ids: &[Option<Uuid>; 4],
) -> Result<Vec<SlotDocument>, sqlx::Error> {
    let ids: Vec<Uuid> = ids.iter().flatten().copied().collect();
    let rows = sqlx::query(
        r#"SELECT d.id, d.auto_name, d.version_number, d.signed_at,
                  (d.status <> 'archived' AND d.file_deleted_at IS NULL
                   AND NOT EXISTS (SELECT 1 FROM documents n WHERE n.replaces_document_id = d.id))
                      AS current
           FROM documents d
           WHERE d.id = ANY($1)"#,
    )
    .bind(&ids)
    .fetch_all(&mut *conn)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(SlotDocument {
                id: row.try_get("id")?,
                title: row.try_get("auto_name")?,
                version: row.try_get("version_number")?,
                signed_at: row.try_get("signed_at")?,
                current: row.try_get("current")?,
            })
        })
        .collect()
}

/// The newest document of a slot template in the lead's scope (the lead or
/// its orders): replaced by the next version when it is unsigned and not out
/// for signature.
struct NewestSlot {
    id: Uuid,
    order_id: Option<Uuid>,
    signed: bool,
    active_request: Option<Uuid>,
}

async fn newest_slot_documents(
    conn: &mut PgConnection,
    lead_id: Uuid,
) -> Result<Vec<Option<NewestSlot>>, sqlx::Error> {
    let mut newest = Vec::with_capacity(SLOTS.len());
    for (_, template) in SLOTS {
        let row = sqlx::query(
            r#"SELECT d.id, d.order_id, d.signed_at IS NOT NULL AS signed,
                      (SELECT r.id FROM document_signature_requests r
                       WHERE r.status IN ('submitting', 'submission_unknown', 'pending')
                         AND (r.source_document_id = d.id OR EXISTS (
                             SELECT 1 FROM document_signature_members m
                             WHERE m.request_id = r.id AND m.document_id = d.id))
                       ORDER BY r.created_at DESC LIMIT 1) AS active_request
               FROM documents d
               WHERE d.generated_template_id = $2
                 AND d.status <> 'archived'
                 AND d.file_deleted_at IS NULL
                 AND NOT EXISTS (SELECT 1 FROM documents n WHERE n.replaces_document_id = d.id)
                 AND (d.lead_id = $1
                      OR d.order_id IN (SELECT o.id FROM orders o WHERE o.source_lead_id = $1))
               ORDER BY d.created_at DESC, d.id DESC
               LIMIT 1"#,
        )
        .bind(lead_id)
        .bind(template)
        .fetch_optional(&mut *conn)
        .await?;
        newest.push(
            row.map(|row| -> Result<NewestSlot, sqlx::Error> {
                Ok(NewestSlot {
                    id: row.try_get("id")?,
                    order_id: row.try_get("order_id")?,
                    signed: row.try_get("signed")?,
                    active_request: row.try_get("active_request")?,
                })
            })
            .transpose()?,
        );
    }
    Ok(newest)
}

/// The client's current Kostenvoranschlag of the order: the newest latest
/// version that is neither archived nor deleted.
async fn client_cost_estimate(
    conn: &mut PgConnection,
    order_id: Option<Uuid>,
) -> Result<Option<Uuid>, sqlx::Error> {
    let Some(order_id) = order_id else {
        return Ok(None);
    };
    sqlx::query_scalar(
        r#"SELECT d.id FROM documents d
           WHERE d.generated_template_id = 'order_cost_estimate'
             AND d.order_id = $1
             AND d.status <> 'archived'
             AND d.file_deleted_at IS NULL
             AND NOT EXISTS (SELECT 1 FROM documents n WHERE n.replaces_document_id = d.id)
           ORDER BY d.created_at DESC, d.id DESC
           LIMIT 1"#,
    )
    .bind(order_id)
    .fetch_optional(&mut *conn)
    .await
}

/// SHA-256 of what document 3 prints of the patient side's answers: the
/// payer named, the relationship, the consent to contact the payer and why
/// the payer pays.
fn patient_statement_fingerprint(
    declaration: &Declaration,
    payment_background: Option<&str>,
) -> String {
    let value = json!([
        declaration.payer_kind,
        declaration.payer_type,
        declaration.organisation_name,
        declaration.first_name,
        declaration.last_name,
        declaration.relationship_kind,
        declaration.relationship,
        declaration
            .contact_consent_at
            .map(|at| at.to_rfc3339_opts(SecondsFormat::Micros, true)),
        payment_background,
    ]);
    document_signatures::provider::sha256(value.to_string().as_bytes())
}

/// Who signs, as recorded and compared: trimmed names, the address in lower
/// case.
#[derive(Clone, Debug, PartialEq, Eq)]
struct SignerFacts {
    first_name: String,
    last_name: String,
    email: String,
    acting_for: Option<String>,
}

impl SignerFacts {
    fn of(subject: &PackageSubject) -> Self {
        let text = |value: Option<&String>| {
            value
                .map(|value| value.trim().to_string())
                .unwrap_or_default()
        };
        Self {
            first_name: text(subject.signer_first_name.as_ref()),
            last_name: text(subject.signer_last_name.as_ref()),
            email: subject
                .confirmed_email
                .as_deref()
                .map(|email| email.trim().to_lowercase())
                .unwrap_or_default(),
            acting_for: subject
                .acting_for
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
        }
    }

    fn recorded(package: &PackageRow) -> Self {
        Self {
            first_name: package.signer_first_name.clone(),
            last_name: package.signer_last_name.clone(),
            email: package.signer_email.clone(),
            acting_for: package.acting_for.clone(),
        }
    }

    fn complete(&self) -> bool {
        !self.first_name.is_empty() && !self.last_name.is_empty() && self.email.contains('@')
    }
}

/// Everything the package API decides on.
struct Facts {
    converted: bool,
    deleted: bool,
    subject: Option<PackageSubject>,
    payer: PayerState,
    consent_required: bool,
    client_estimate: Option<Uuid>,
    fingerprint: Option<String>,
    package: Option<PackageRow>,
    request: Option<RequestFacts>,
    documents: Vec<SlotDocument>,
    newest: Vec<Option<NewestSlot>>,
}

async fn load_facts(conn: &mut PgConnection, lead_id: Uuid) -> Result<Option<Facts>, sqlx::Error> {
    let Some(lead) = sqlx::query(
        r#"SELECT converted_patient_id IS NOT NULL AS converted,
                  (qualification_status = 'deleted'
                   OR COALESCE(failed_outcome_status, 'none') = 'delete_anonymized') AS deleted
           FROM leads WHERE id = $1"#,
    )
    .bind(lead_id)
    .fetch_optional(&mut *conn)
    .await?
    else {
        return Ok(None);
    };
    let subject = lead_payer_link::package_subject(conn, lead_id).await?;
    let payer = lead_payer::load_payer_state(conn, lead_id).await?;
    let representation = lead_representatives::load(conn, lead_id)
        .await?
        .unwrap_or_default()
        .representation;
    let consent_required =
        lead_payer::contact_consent_required(payer.declaration.as_ref(), &representation);
    let (statements, _) = intake::load_identification(&mut *conn, lead_id).await?;
    let fingerprint = payer
        .declaration
        .as_ref()
        .filter(|declaration| declaration.is_third_party())
        .map(|declaration| {
            patient_statement_fingerprint(declaration, statements.payment_background.as_deref())
        });
    let client_estimate = client_cost_estimate(conn, payer.order_id).await?;
    let package = load_package(conn, lead_id).await?;
    let request = load_request(conn, package.as_ref().and_then(|p| p.request_id)).await?;
    let documents = match &package {
        Some(package) => load_slot_documents(conn, &package.documents).await?,
        None => Vec::new(),
    };
    let newest = newest_slot_documents(conn, lead_id).await?;
    Ok(Some(Facts {
        converted: lead.try_get("converted")?,
        deleted: lead.try_get("deleted")?,
        subject,
        payer,
        consent_required,
        client_estimate,
        fingerprint,
        package,
        request,
        documents,
        newest,
    }))
}

impl Facts {
    fn third_party(&self) -> Option<&Declaration> {
        self.payer
            .declaration
            .as_ref()
            .filter(|declaration| declaration.is_third_party())
    }

    /// What the declaration still lacks besides the Kostenübernahmeerklärung
    /// (which this package brings).
    fn declaration_missing(&self) -> Vec<&'static str> {
        if self.third_party().is_none() {
            return Vec::new();
        }
        self.payer
            .readiness()
            .reasons
            .into_iter()
            .filter(|reason| {
                !matches!(
                    reason,
                    PayerReason::CostAssumptionMissing
                        | PayerReason::CostAssumptionOutdated
                        | PayerReason::CostAssumptionUnsigned
                )
            })
            .map(PayerReason::code)
            .collect()
    }

    fn signer(&self) -> Option<SignerFacts> {
        self.subject.as_ref().map(SignerFacts::of)
    }

    /// The first reason why the package cannot be prepared or sent now.
    fn blocked_reason(&self) -> Option<&'static str> {
        if self.converted {
            return Some("lead_converted");
        }
        if self.deleted {
            return Some("lead_deleted");
        }
        let (Some(declaration), Some(subject)) = (self.third_party(), self.subject.as_ref()) else {
            return Some("no_third_party");
        };
        if subject.submitted_at.is_none() || subject.confirmed_email.is_none() {
            return Some("payer_not_submitted");
        }
        if !self.declaration_missing().is_empty() {
            return Some("payer_declaration_incomplete");
        }
        if self.consent_required && declaration.cost_estimate_consent_at.is_none() {
            return Some("cost_estimate_consent_missing");
        }
        if self.payer.order_id.is_none() {
            return Some("order_missing");
        }
        if self.client_estimate.is_none() {
            return Some("cost_estimate_missing");
        }
        if !self.signer().is_some_and(|signer| signer.complete()) {
            return Some("payer_signer_incomplete");
        }
        let own_request = self.package.as_ref().and_then(|package| package.request_id);
        if self.newest.iter().flatten().any(|slot| {
            slot.active_request
                .is_some_and(|request| Some(request) != own_request)
        }) {
            return Some("payer_documents_pending");
        }
        None
    }

    fn status(&self) -> Option<&'static str> {
        self.package
            .as_ref()
            .map(|_| package_status(self.request.as_ref()))
    }

    /// Why the prepared documents no longer say what holds now.
    fn outdated_reasons(&self) -> Vec<&'static str> {
        let Some(package) = &self.package else {
            return Vec::new();
        };
        let mut reasons = Vec::new();
        let submitted_at = self
            .subject
            .as_ref()
            .and_then(|subject| subject.submitted_at);
        if submitted_at != Some(package.statement_submitted_at) {
            reasons.push("payer_answers_changed");
        }
        if self.payer.identity_changed_at != Some(package.payer_identity_changed_at) {
            reasons.push("payer_changed");
        }
        if self.signer() != Some(SignerFacts::recorded(package)) {
            reasons.push("signer_changed");
        }
        if self.client_estimate != package.cost_estimate_document_id {
            reasons.push("cost_estimate_changed");
        }
        if self.fingerprint.as_deref() != Some(package.patient_statement_fingerprint.as_str()) {
            reasons.push("patient_statement_changed");
        }
        let replaced = package.documents.iter().any(|id| {
            !id.is_some_and(|id| {
                self.documents
                    .iter()
                    .any(|document| document.id == id && document.current)
            })
        });
        if replaced {
            reasons.push("document_replaced");
        }
        reasons
    }
}

// ----------------------------------------------------------------------------
// Views
// ----------------------------------------------------------------------------

async fn view(
    state: &AppState,
    auth: &AuthUser,
    conn: &mut PgConnection,
    lead_id: Uuid,
) -> Result<Option<Value>, sqlx::Error> {
    let Some(facts) = load_facts(conn, lead_id).await? else {
        return Ok(None);
    };
    let signature_enabled = matches!(
        document_signatures::connection::current_provider(state).await,
        Ok(Some(_))
    );
    let blocked = facts.blocked_reason();
    let status = facts.status();
    let outdated = facts.outdated_reasons();
    let manager = may_send(auth);
    let can_prepare = manager
        && blocked.is_none()
        && !matches!(status, Some("sending" | "pending" | "needs_review"))
        && !(status == Some("signed") && outdated.is_empty());
    let can_send = manager
        && signature_enabled
        && blocked.is_none()
        && matches!(
            status,
            Some("prepared" | "declined" | "withdrawn" | "expired" | "error")
        )
        && outdated.is_empty();
    let attachments = match facts
        .package
        .as_ref()
        .and_then(|package| package.request_id)
    {
        Some(request_id) => sqlx::query(
            r#"SELECT a.document_id, d.auto_name
               FROM document_signature_attachments a
               JOIN documents d ON d.id = a.document_id
               WHERE a.request_id = $1
               ORDER BY a.position"#,
        )
        .bind(request_id)
        .fetch_all(&mut *conn)
        .await?
        .iter()
        .map(|row| {
            json!({
                "document_id": row.try_get::<Uuid, _>("document_id").ok(),
                "title": row.try_get::<String, _>("auto_name").ok(),
            })
        })
        .collect::<Vec<_>>(),
        None => Vec::new(),
    };
    let package = facts.package.as_ref().map(|package| {
        let documents = SLOTS
            .iter()
            .zip(package.documents.iter())
            .map(|((slot, _), id)| {
                let document = id.and_then(|id| facts.documents.iter().find(|doc| doc.id == id));
                json!({
                    "slot": slot,
                    "document_id": id,
                    "title": document.map(|document| document.title.clone()),
                    "version": document.map(|document| document.version),
                    "signed_at": document.and_then(|document| document.signed_at),
                })
            })
            .collect::<Vec<_>>();
        json!({
            "id": package.id,
            "status": status,
            "outdated_reasons": outdated,
            "prepared_at": package.prepared_at,
            "prepared_by_name": package.prepared_by_name,
            "sent_at": package.sent_at,
            "sent_by_name": package.sent_by_name,
            "language": package.language,
            "request_id": package.request_id,
            "test_mode": facts.request.as_ref().is_some_and(|request| request.test_mode),
            "signed_at": facts.request.as_ref().and_then(|request| request.signed_at),
            "documents": documents,
            "attachments": attachments,
        })
    });
    let identification = lead_identification::load_identification_status(conn, lead_id).await?;
    let payer_identification = identification.payer.as_ref().map(|payer| {
        json!({
            "qes_signed_at": payer.qes.map(|qes| qes.signed_at),
            "qes_test_mode": payer.qes.is_some_and(|qes| qes.test_mode),
            "own_account_payment_confirmed_at": payer
                .own_account_payment
                .as_ref()
                .map(|payment| payment.confirmed_at),
        })
    });
    let suggested_language = facts
        .subject
        .as_ref()
        .and_then(|subject| subject.language.as_deref())
        .filter(|language| document_signatures::invitation_languages().contains(language))
        .unwrap_or("de");
    Ok(Some(json!({
        "mode": facts.subject.as_ref().map(|subject| subject.mode),
        "blocked_reason": blocked,
        "missing": facts.declaration_missing(),
        "can_prepare": can_prepare,
        "can_send": can_send,
        "signature_enabled": signature_enabled,
        "languages": document_signatures::invitation_languages(),
        "suggested_language": suggested_language,
        "signer": facts.signer().map(|signer| json!({
            "first_name": Some(signer.first_name).filter(|value| !value.is_empty()),
            "last_name": Some(signer.last_name).filter(|value| !value.is_empty()),
            "email": Some(signer.email).filter(|value| !value.is_empty()),
            "acting_for": signer.acting_for,
        })),
        "order": facts.payer.order_id.map(|id| json!({
            "id": id,
            "number": facts.payer.order_number,
        })),
        "cost_estimate_document_id": facts.client_estimate,
        "package": package,
        "payer_identification": payer_identification,
    })))
}

async fn view_response(
    state: &AppState,
    auth: &AuthUser,
    lead_id: Uuid,
    status: StatusCode,
) -> Response {
    let mut conn = match state.db.acquire().await {
        Ok(conn) => conn,
        Err(error) => return database(error, "acquire payer package"),
    };
    match view(state, auth, &mut conn, lead_id).await {
        Ok(Some(value)) => (status, Json(value)).into_response(),
        Ok(None) => refuse(
            StatusCode::NOT_FOUND,
            "not_found",
            "Lead not found",
            json!({}),
        ),
        Err(error) => database(error, "load payer package"),
    }
}

/// `status.payer_package` of `GET /leads/{id}/payer-declaration`: the
/// package's status, whether it is outdated and its two dates; `null`
/// without a package.
pub(crate) async fn status_summary(
    conn: &mut PgConnection,
    lead_id: Uuid,
) -> Result<Value, sqlx::Error> {
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM lead_payer_signature_packages WHERE lead_id = $1 AND superseded_at IS NULL)",
    )
    .bind(lead_id)
    .fetch_one(&mut *conn)
    .await?;
    if !exists {
        return Ok(Value::Null);
    }
    let Some(facts) = load_facts(conn, lead_id).await? else {
        return Ok(Value::Null);
    };
    let Some(package) = &facts.package else {
        return Ok(Value::Null);
    };
    Ok(json!({
        "status": facts.status(),
        "outdated": !facts.outdated_reasons().is_empty(),
        "sent_at": package.sent_at,
        "signed_at": facts.request.as_ref().and_then(|request| request.signed_at),
    }))
}

/// `signature_package` of the payer's own page and of the paying parent's
/// cabinet section: `sent` while the invitation is out, `signed` once the
/// signed documents arrived, else `null` — and only for the package whose
/// signer is the confirmed address of the payer's statement. No titles, ids
/// or request data.
pub(crate) async fn payer_view(
    conn: &mut PgConnection,
    lead_id: Uuid,
    confirmed_email: Option<&str>,
) -> Result<Value, sqlx::Error> {
    let Some(confirmed_email) = confirmed_email
        .map(|email| email.trim().to_lowercase())
        .filter(|email| !email.is_empty())
    else {
        return Ok(Value::Null);
    };
    let Some(row) = sqlx::query(
        r#"SELECT p.signer_email, p.sent_at, r.status, r.signed_at
           FROM lead_payer_signature_packages p
           LEFT JOIN document_signature_requests r ON r.id = p.request_id
           WHERE p.lead_id = $1 AND p.superseded_at IS NULL"#,
    )
    .bind(lead_id)
    .fetch_optional(&mut *conn)
    .await?
    else {
        return Ok(Value::Null);
    };
    let signer_email: String = row.try_get("signer_email")?;
    if signer_email.trim().to_lowercase() != confirmed_email {
        return Ok(Value::Null);
    }
    let status: Option<String> = row.try_get("status")?;
    let shown = match status.as_deref() {
        Some("submitting" | "submission_unknown" | "pending") => "sent",
        Some("completed") => "signed",
        _ => return Ok(Value::Null),
    };
    Ok(json!({
        "status": shown,
        "sent_at": row.try_get::<Option<DateTime<Utc>>, _>("sent_at")?,
        "signed_at": if shown == "signed" {
            row.try_get::<Option<DateTime<Utc>>, _>("signed_at")?
        } else {
            None
        },
    }))
}

// ----------------------------------------------------------------------------
// Handlers
// ----------------------------------------------------------------------------

/// `GET /leads/{id}/payer-signature-package`.
async fn get_package(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
) -> Response {
    if !lead_payer::may_view(&auth) {
        return refuse(
            StatusCode::FORBIDDEN,
            "forbidden",
            "Insufficient permissions",
            json!({}),
        );
    }
    view_response(&state, &auth, lead_id, StatusCode::OK).await
}

/// Serialises prepare and send of one lead's package across requests and
/// server processes. An advisory lock rather than a row lock of the lead: the
/// documents are generated on other connections, and their foreign key to
/// the lead would wait for a row lock held here.
async fn lock_package(
    tx: &mut Transaction<'static, Postgres>,
    lead_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "SELECT pg_advisory_xact_lock(hashtextextended('lead-payer-package:' || $1::text, 0))",
    )
    .bind(lead_id)
    .execute(&mut **tx)
    .await
    .map(|_| ())
}

/// The refusal for a package whose status allows neither prepare nor send.
fn status_refusal(status: Option<&str>, outdated: &[&str]) -> Option<Response> {
    match status {
        Some("sending" | "pending" | "needs_review") => Some(refuse(
            StatusCode::CONFLICT,
            "payer_package_pending",
            "The package is out for signature",
            json!({}),
        )),
        Some("signed") if outdated.is_empty() => Some(refuse(
            StatusCode::CONFLICT,
            "payer_package_signed",
            "The package is signed",
            json!({}),
        )),
        _ => None,
    }
}

/// `POST /leads/{id}/payer-signature-package/prepare`: fresh versions of the
/// four documents and a new package row recording what they were made from.
async fn prepare(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
) -> Response {
    if !may_send(&auth) {
        return refuse(
            StatusCode::FORBIDDEN,
            "forbidden",
            "Insufficient permissions",
            json!({}),
        );
    }
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return database(error, "begin payer package"),
    };
    if let Err(error) = lock_package(&mut tx, lead_id).await {
        return database(error, "lock payer package");
    }
    let facts = match load_facts(&mut tx, lead_id).await {
        Ok(Some(facts)) => facts,
        Ok(None) => {
            return refuse(
                StatusCode::NOT_FOUND,
                "not_found",
                "Lead not found",
                json!({}),
            );
        }
        Err(error) => return database(error, "load payer package"),
    };
    if let Some(reason) = facts.blocked_reason() {
        return refuse(
            StatusCode::CONFLICT,
            reason,
            blocked_message(reason),
            json!({ "missing": facts.declaration_missing() }),
        );
    }
    if let Some(response) = status_refusal(facts.status(), &facts.outdated_reasons()) {
        return response;
    }
    // What the documents are made from (checked by `blocked_reason`).
    let (Some(subject), Some(signer), Some(order_id), Some(client_estimate), Some(identity)) = (
        facts.subject.as_ref(),
        facts.signer(),
        facts.payer.order_id,
        facts.client_estimate,
        facts.payer.identity_changed_at,
    ) else {
        return refuse(
            StatusCode::CONFLICT,
            "payer_declaration_incomplete",
            blocked_message("payer_declaration_incomplete"),
            json!({ "missing": facts.declaration_missing() }),
        );
    };
    let (Some(submitted_at), Some(fingerprint)) = (subject.submitted_at, facts.fingerprint.clone())
    else {
        return refuse(
            StatusCode::CONFLICT,
            "payer_not_submitted",
            blocked_message("payer_not_submitted"),
            json!({}),
        );
    };
    let mut document_ids = Vec::with_capacity(SLOTS.len());
    for (index, (_, template)) in SLOTS.into_iter().enumerate() {
        let order = slot_needs_order(template).then_some(order_id);
        let replace = facts.newest[index]
            .as_ref()
            .filter(|newest| {
                !newest.signed && newest.active_request.is_none() && newest.order_id == order
            })
            .map(|newest| newest.id);
        match generate_lead_document(
            &state,
            &auth,
            LeadDocumentGeneration {
                template_id: template,
                lead_id,
                order_id: order,
                replace_document_id: replace,
                bindings_from_document_id: (template == "payer_cost_estimate")
                    .then_some(client_estimate),
            },
        )
        .await
        {
            Ok(id) => document_ids.push(id),
            Err(response) => return response,
        }
    }
    if let Err(error) = sqlx::query(
        "UPDATE lead_payer_signature_packages SET superseded_at = now() WHERE lead_id = $1 AND superseded_at IS NULL",
    )
    .bind(lead_id)
    .execute(&mut *tx)
    .await
    {
        return database(error, "supersede payer package");
    }
    let package_id: Uuid = match sqlx::query_scalar(
        r#"INSERT INTO lead_payer_signature_packages (
               lead_id, order_id, mode, signer_first_name, signer_last_name, signer_email,
               acting_for, statement_submitted_at, payer_identity_changed_at,
               patient_statement_fingerprint, cost_estimate_document_id,
               self_disclosure_document_id, cost_coverage_document_id,
               patient_statement_document_id, payer_cost_estimate_document_id, prepared_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
           RETURNING id"#,
    )
    .bind(lead_id)
    .bind(order_id)
    .bind(subject.mode)
    .bind(&signer.first_name)
    .bind(&signer.last_name)
    .bind(&signer.email)
    .bind(&signer.acting_for)
    .bind(submitted_at)
    .bind(identity)
    .bind(&fingerprint)
    .bind(client_estimate)
    .bind(document_ids[0])
    .bind(document_ids[1])
    .bind(document_ids[2])
    .bind(document_ids[3])
    .bind(auth.user_id)
    .fetch_one(&mut *tx)
    .await
    {
        Ok(id) => id,
        Err(error) => return database(error, "store payer package"),
    };
    if let Err(error) = audit::write_in_transaction(
        &mut tx,
        &audit::domain_event(
            "payer_package_prepared",
            Some(auth.user_id),
            "lead",
            Some(lead_id),
            json!({
                "package_id": package_id,
                "document_ids": document_ids,
                "mode": subject.mode,
            }),
        ),
    )
    .await
    {
        return database(error, "audit payer package");
    }
    if let Err(error) = tx.commit().await {
        return database(error, "commit payer package");
    }
    publish(&state, auth.user_id, lead_id).await;
    view_response(&state, &auth, lead_id, StatusCode::OK).await
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SendBody {
    package_id: Uuid,
    #[serde(default)]
    language: Option<String>,
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    expires_at: Option<DateTime<Utc>>,
}

/// `POST /leads/{id}/payer-signature-package/send`: the signature request of
/// exactly the prepared documents, signed by the payer and GMED, level QES.
async fn send(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
    Json(body): Json<SendBody>,
) -> Response {
    if !may_send(&auth) {
        return refuse(
            StatusCode::FORBIDDEN,
            "forbidden",
            "Insufficient permissions",
            json!({}),
        );
    }
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return database(error, "begin payer package"),
    };
    if let Err(error) = lock_package(&mut tx, lead_id).await {
        return database(error, "lock payer package");
    }
    let facts = match load_facts(&mut tx, lead_id).await {
        Ok(Some(facts)) => facts,
        Ok(None) => {
            return refuse(
                StatusCode::NOT_FOUND,
                "not_found",
                "Lead not found",
                json!({}),
            );
        }
        Err(error) => return database(error, "load payer package"),
    };
    if let Some(reason) = facts.blocked_reason() {
        return refuse(
            StatusCode::CONFLICT,
            reason,
            blocked_message(reason),
            json!({ "missing": facts.declaration_missing() }),
        );
    }
    let Some(package) = &facts.package else {
        return refuse(
            StatusCode::CONFLICT,
            "payer_package_not_prepared",
            "Prepare the documents first",
            json!({}),
        );
    };
    if package.id != body.package_id {
        return refuse(
            StatusCode::CONFLICT,
            "payer_package_stale",
            "The documents were prepared again; reload",
            json!({ "package_id": package.id }),
        );
    }
    let outdated = facts.outdated_reasons();
    if !outdated.is_empty() {
        return refuse(
            StatusCode::CONFLICT,
            "payer_package_outdated",
            "The prepared documents are outdated; prepare them again",
            json!({ "reasons": outdated }),
        );
    }
    if let Some(response) = status_refusal(facts.status(), &outdated) {
        return response;
    }
    if !matches!(
        document_signatures::connection::current_provider(&state).await,
        Ok(Some(_))
    ) {
        return refuse(
            StatusCode::SERVICE_UNAVAILABLE,
            "signature_not_configured",
            "The electronic signature is not connected",
            json!({}),
        );
    }
    let Some(document_ids) = package
        .documents
        .iter()
        .copied()
        .collect::<Option<Vec<Uuid>>>()
    else {
        return refuse(
            StatusCode::CONFLICT,
            "payer_package_outdated",
            "The prepared documents are outdated; prepare them again",
            json!({ "reasons": ["document_replaced"] }),
        );
    };
    let language = body
        .language
        .as_deref()
        .map(str::trim)
        .filter(|language| !language.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| {
            facts
                .subject
                .as_ref()
                .and_then(|subject| subject.language.as_deref())
                .filter(|language| document_signatures::invitation_languages().contains(language))
                .unwrap_or("de")
                .to_string()
        });
    let request_id = match document_signatures::create_fixed_package(
        &state,
        &auth,
        FixedPackage {
            document_ids,
            signers: vec![Signer {
                first_name: package.signer_first_name.clone(),
                last_name: package.signer_last_name.clone(),
                email: package.signer_email.clone(),
                role: "payer".into(),
                positions: Vec::new(),
            }],
            language: Some(language.clone()),
            note: body.message.clone(),
            expires_at: body.expires_at,
        },
    )
    .await
    {
        Ok(id) => id,
        Err(response) => return response,
    };
    if let Err(error) = sqlx::query(
        r#"UPDATE lead_payer_signature_packages
           SET request_id = $2, sent_by = $3, sent_at = now(), language = $4
           WHERE id = $1"#,
    )
    .bind(package.id)
    .bind(request_id)
    .bind(auth.user_id)
    .bind(&language)
    .execute(&mut *tx)
    .await
    {
        return database(error, "store payer package request");
    }
    if let Err(error) = audit::write_in_transaction(
        &mut tx,
        &audit::domain_event(
            "payer_package_sent",
            Some(auth.user_id),
            "lead",
            Some(lead_id),
            json!({
                "package_id": package.id,
                "request_id": request_id,
                "mode": package.mode,
            }),
        ),
    )
    .await
    {
        return database(error, "audit payer package request");
    }
    if let Err(error) = tx.commit().await {
        return database(error, "commit payer package request");
    }
    publish(&state, auth.user_id, lead_id).await;
    view_response(&state, &auth, lead_id, StatusCode::ACCEPTED).await
}

async fn publish(state: &AppState, actor: Uuid, lead_id: Uuid) {
    crate::realtime::publish_lead_event(
        state,
        Some(actor),
        "lead.portal_updated",
        lead_id,
        json!({ "change": "payer_package" }),
    )
    .await;
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CostEstimateConsentBody {
    consent: bool,
}

/// `POST /me/lead-requests/{lead_id}/payer/cost-estimate-consent`: the
/// lead's own consent that GMED passes the cost estimate — service types and
/// amounts only — on to the third-party payer named (owner decision
/// 2026-10-06). `true` records it now unless it is recorded, `false` removes
/// it. Also while the payer's identity is the payer's own answer: the
/// consent is the patient's. Returns the request object.
async fn cost_estimate_consent(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
    Json(body): Json<CostEstimateConsentBody>,
) -> Response {
    if let Err(response) = intake::require_patient(&auth) {
        return response;
    }
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return intake::internal(error, "begin"),
    };
    let (kind, _) = match intake::lock_my_lead(&mut tx, lead_id, auth.user_id).await {
        Ok(Some(found)) => found,
        Ok(None) => return intake::not_found(),
        Err(error) => return intake::internal(error, "lock request"),
    };
    let declaration = match lead_payer::load_declaration(&mut tx, lead_id).await {
        Ok(declaration) => declaration,
        Err(error) => return intake::internal(error, "load payer"),
    };
    let Some(declaration) = declaration.filter(Declaration::is_third_party) else {
        return intake::coded(
            StatusCode::CONFLICT,
            "no_third_party_payer",
            "No third party pays: there is nobody to pass the cost estimate on to",
            json!({}),
        );
    };
    let next = if body.consent {
        // The precision the database keeps.
        declaration
            .cost_estimate_consent_at
            .or_else(|| Some(Utc::now().trunc_subsecs(6)))
    } else {
        None
    };
    if next != declaration.cost_estimate_consent_at {
        if let Err(error) = sqlx::query(
            r#"UPDATE lead_payer_declarations
               SET cost_estimate_consent_at = $2, updated_by = $3, updated_at = now()
               WHERE lead_id = $1"#,
        )
        .bind(lead_id)
        .bind(next)
        .bind(auth.user_id)
        .execute(&mut *tx)
        .await
        {
            return intake::internal(error, "save cost estimate consent");
        }
        if let Err(error) = audit::write_in_transaction(
            &mut tx,
            &audit::domain_event(
                "lead_portal_payer_cost_estimate_consent",
                Some(auth.user_id),
                "lead",
                Some(lead_id),
                json!({ "consent": body.consent, "access_kind": kind.as_str() }),
            ),
        )
        .await
        {
            return intake::internal(error, "audit cost estimate consent");
        }
        if let Err(error) = tx.commit().await {
            return intake::internal(error, "commit cost estimate consent");
        }
        crate::realtime::publish_lead_event(
            &state,
            Some(auth.user_id),
            "lead.portal_updated",
            lead_id,
            json!({ "change": "payer", "access_kind": kind.as_str() }),
        )
        .await;
    } else {
        drop(tx);
    }
    match intake::request_payload(&state, lead_id, auth.user_id, kind).await {
        Ok(payload) => Json(payload).into_response(),
        Err(error) => intake::internal(error, "load request"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn third_party() -> Declaration {
        Declaration {
            payer_kind: lead_payer::PAYER_KIND_THIRD_PARTY.into(),
            payer_type: Some("person".into()),
            first_name: Some("Viktor".into()),
            last_name: Some("Zahler".into()),
            relationship_kind: Some("friend".into()),
            ..Declaration::default()
        }
    }

    #[test]
    fn the_patient_statement_fingerprint_follows_what_document_three_prints() {
        let declaration = third_party();
        let base = patient_statement_fingerprint(&declaration, Some("Er ist mein Onkel."));
        assert_eq!(base.len(), 64);
        assert!(base.bytes().all(|byte| byte.is_ascii_hexdigit()));
        assert_eq!(
            base,
            patient_statement_fingerprint(&declaration, Some("Er ist mein Onkel."))
        );
        assert_ne!(
            base,
            patient_statement_fingerprint(&declaration, Some("Er ist ein Freund."))
        );
        let consented = Declaration {
            contact_consent_at: Some(Utc::now()),
            ..third_party()
        };
        assert_ne!(
            base,
            patient_statement_fingerprint(&consented, Some("Er ist mein Onkel."))
        );
        // What document 3 does not print changes nothing.
        let elsewhere = Declaration {
            phone: Some("+43 1 000000".into()),
            date_of_birth: chrono::NaiveDate::from_ymd_opt(1970, 5, 1),
            ..third_party()
        };
        assert_eq!(
            base,
            patient_statement_fingerprint(&elsewhere, Some("Er ist mein Onkel."))
        );
    }

    #[test]
    fn the_status_is_read_from_the_request() {
        let request = |status: &str| RequestFacts {
            status: status.into(),
            test_mode: false,
            signed_at: None,
        };
        assert_eq!(package_status(None), "prepared");
        for (stored, shown) in [
            ("submitting", "sending"),
            ("submission_unknown", "sending"),
            ("pending", "pending"),
            ("completed", "signed"),
            ("needs_review", "needs_review"),
            ("declined", "declined"),
            ("withdrawn", "withdrawn"),
            ("expired", "expired"),
            ("error", "error"),
        ] {
            assert_eq!(package_status(Some(&request(stored))), shown);
        }
        assert!(status_refusal(Some("pending"), &[]).is_some());
        assert!(status_refusal(Some("signed"), &[]).is_some());
        assert!(status_refusal(Some("signed"), &["payer_changed"]).is_none());
        assert!(status_refusal(Some("withdrawn"), &[]).is_none());
        assert!(slot_needs_order("payer_cost_estimate"));
        assert!(!slot_needs_order("payer_self_disclosure"));
    }
}
