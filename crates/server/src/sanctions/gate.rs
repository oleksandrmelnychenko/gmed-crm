//! Server-side blocks from sanctions hits and the blocked-country policy.
//!
//! | block | qualify / convert | agency countersignature | other order / contract work |
//! |---|---|---|---|
//! | confirmed hit (permanent, nobody can lift it) | blocked | blocked | blocked |
//! | open hit (until the CEO decides) | blocked | blocked | blocked |
//! | blocked country (CEO can lift per lead) | blocked | blocked | allowed |
//!
//! The countersignature is `signed_agency` on the order, a framework contract
//! set to `signed`, an e-signature package with an agency signer and a paper
//! signature of an order or contract document. The client's own paper
//! signature of a document only the patient side signs (consents, the lead's
//! patient form) is other work, also when the document names an order.
//!
//! A false-positive decision unblocks. Winding down stays possible: cancelling
//! an order or an order service, terminating a framework contract, rejecting
//! or deleting a quote, supplier invoices and dunning are never blocked.
//!
//! The gate is one middleware on the protected router ([`middleware`]) so the
//! rule lives in one place instead of in every handler. [`classify`] maps the
//! guarded routes; its tests pin the list.

use axum::{
    Json,
    body::Body,
    extract::{Request, State},
    http::{Method, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use chrono::NaiveDate;
use serde::Serialize;
use serde_json::{Value, json};
use sqlx::Row;
use uuid::Uuid;

use super::policy::{self, CountryOverride};
use super::screening;
use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::state::AppState;

/// Largest JSON body the gate reads (the axum default limit).
const MAX_GATE_BODY: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum GateAction {
    QualifyOrConvert,
    AgencyCountersign,
    OrderContractWork,
}

impl GateAction {
    fn as_str(self) -> &'static str {
        match self {
            Self::QualifyOrConvert => "qualify_or_convert",
            Self::AgencyCountersign => "agency_countersign",
            Self::OrderContractWork => "order_contract_work",
        }
    }
}

/// Leads and patients one request concerns.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Scope {
    pub lead_ids: Vec<Uuid>,
    pub patient_ids: Vec<Uuid>,
}

impl Scope {
    pub fn lead(lead_id: Uuid) -> Self {
        Self {
            lead_ids: vec![lead_id],
            patient_ids: Vec::new(),
        }
    }

    pub fn patient(patient_id: Uuid) -> Self {
        Self {
            lead_ids: Vec::new(),
            patient_ids: vec![patient_id],
        }
    }

    fn add_lead(&mut self, lead_id: Option<Uuid>) {
        if let Some(lead_id) = lead_id
            && !self.lead_ids.contains(&lead_id)
        {
            self.lead_ids.push(lead_id);
        }
    }

    fn add_patient(&mut self, patient_id: Option<Uuid>) {
        if let Some(patient_id) = patient_id
            && !self.patient_ids.contains(&patient_id)
        {
            self.patient_ids.push(patient_id);
        }
    }

    pub fn is_empty(&self) -> bool {
        self.lead_ids.is_empty() && self.patient_ids.is_empty()
    }

    /// Adds the lead a patient came from and the patient a lead became.
    pub async fn expand(mut self, db: &gmed_db::DbPool) -> Result<Self, sqlx::Error> {
        if self.is_empty() {
            return Ok(self);
        }
        let rows = sqlx::query(
            r#"SELECT id, converted_patient_id, prospect_patient_id
               FROM leads
               WHERE id = ANY($1)
                  OR converted_patient_id = ANY($2)
                  OR prospect_patient_id = ANY($2)"#,
        )
        .bind(&self.lead_ids)
        .bind(&self.patient_ids)
        .fetch_all(db)
        .await?;
        for row in rows {
            self.add_lead(row.try_get("id")?);
            self.add_patient(row.try_get("converted_patient_id")?);
            self.add_patient(row.try_get("prospect_patient_id")?);
        }
        Ok(self)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum BlockKind {
    SanctionsConfirmed,
    SanctionsReviewPending,
    BlockedCountry,
}

impl BlockKind {
    pub fn code(self) -> &'static str {
        match self {
            Self::SanctionsConfirmed => "sanctions_confirmed",
            Self::SanctionsReviewPending => "sanctions_review_pending",
            Self::BlockedCountry => "blocked_country",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Block {
    pub kind: BlockKind,
    pub code: &'static str,
    pub message: String,
    /// A confirmed hit is final; nobody lifts it.
    pub permanent: bool,
    pub countries: Vec<String>,
}

impl Block {
    fn sanctions(confirmed: bool) -> Self {
        if confirmed {
            Self {
                kind: BlockKind::SanctionsConfirmed,
                code: BlockKind::SanctionsConfirmed.code(),
                message: "Confirmed EU sanctions list match: work with this person or organisation is permanently stopped".into(),
                permanent: true,
                countries: Vec::new(),
            }
        } else {
            Self {
                kind: BlockKind::SanctionsReviewPending,
                code: BlockKind::SanctionsReviewPending.code(),
                message: "Possible EU sanctions list match awaiting the CEO's review: blocked until the CEO decides".into(),
                permanent: false,
                countries: Vec::new(),
            }
        }
    }

    fn country(countries: Vec<String>) -> Self {
        Self {
            kind: BlockKind::BlockedCountry,
            code: BlockKind::BlockedCountry.code(),
            message: format!(
                "Blocked country ({}): qualification, conversion and the agency countersignature need the CEO to lift the block for this lead",
                countries.join(", ")
            ),
            permanent: false,
            countries,
        }
    }

    pub fn response(&self) -> Response {
        (
            StatusCode::CONFLICT,
            Json(json!({
                "error": self.code,
                "message": self.message,
                "permanent": self.permanent,
                "countries": self.countries,
                "countries_label": self.countries.join(", "),
            })),
        )
            .into_response()
    }
}

/// Open and confirmed hits of the expanded scope.
async fn hit_counts(db: &gmed_db::DbPool, scope: &Scope) -> Result<(i64, i64), sqlx::Error> {
    let row = sqlx::query(
        r#"SELECT COUNT(*) FILTER (WHERE status = 'open') AS open_hits,
                  COUNT(*) FILTER (WHERE status = 'confirmed') AS confirmed_hits
           FROM sanctions_hits
           WHERE lead_id = ANY($1) OR patient_id = ANY($2)"#,
    )
    .bind(&scope.lead_ids)
    .bind(&scope.patient_ids)
    .fetch_one(db)
    .await?;
    Ok((row.try_get("open_hits")?, row.try_get("confirmed_hits")?))
}

/// Citizenship and residence codes of every subject in the scope.
async fn scope_countries(db: &gmed_db::DbPool, scope: &Scope) -> Result<Vec<String>, sqlx::Error> {
    let mut countries: Vec<String> = Vec::new();
    let mut push = |codes: Vec<String>| {
        for code in codes {
            if !countries.contains(&code) {
                countries.push(code);
            }
        }
    };
    for lead in screening::load_leads_subjects(db, &scope.lead_ids).await? {
        for subject in lead.subjects {
            push(subject.countries());
        }
    }
    for patient_id in &scope.patient_ids {
        if let Some(subject) = screening::load_patient_subject(db, *patient_id).await? {
            push(subject.countries());
        }
    }
    Ok(countries)
}

/// The block for `action` on `scope`, if any. Before a decision point the
/// scope is screened once more, so a payer added a minute ago is covered.
pub async fn evaluate(
    state: &AppState,
    scope: Scope,
    action: GateAction,
) -> Result<Option<Block>, sqlx::Error> {
    let scope = scope.expand(&state.db).await?;
    if scope.is_empty() {
        return Ok(None);
    }
    if action != GateAction::OrderContractWork {
        for lead_id in &scope.lead_ids {
            screening::screen_lead(state, *lead_id).await?;
        }
        for patient_id in &scope.patient_ids {
            screening::screen_patient(state, *patient_id).await?;
        }
    }
    let (open_hits, confirmed_hits) = hit_counts(&state.db, &scope).await?;
    if confirmed_hits > 0 {
        return Ok(Some(Block::sanctions(true)));
    }
    if open_hits > 0 {
        return Ok(Some(Block::sanctions(false)));
    }
    if action == GateAction::OrderContractWork {
        return Ok(None);
    }
    let blocked = policy::blocked_countries(&state.db).await?;
    if blocked.is_empty() {
        return Ok(None);
    }
    let countries = scope_countries(&state.db, &scope).await?;
    let overrides =
        policy::active_overrides(&state.db, &scope.lead_ids, &scope.patient_ids).await?;
    let evaluation = policy::evaluate_countries(&countries, &blocked, &overrides);
    if evaluation.blocking.is_empty() {
        Ok(None)
    } else {
        Ok(Some(Block::country(evaluation.blocking)))
    }
}

/// What the gate guards on a route.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Rule {
    Always(GateAction),
    /// `status: "qualified"` qualifies; other statuses pass.
    LeadQualify,
    /// `status: "cancelled"` winds the order down and passes.
    OrderStatus,
    /// `signed_agency: true` is the countersignature.
    OrderCommercialBasis,
    /// `status: "signed"` is the countersignature.
    ContractStatus,
    /// Rejecting or letting a quote expire passes.
    QuoteStatus,
    /// A package with an agency signer is the countersignature.
    SignatureRequest,
    /// A signature recorded on paper (multipart scan): the countersignature
    /// for order and contract documents, other work for the rest
    /// ([`paper_signature_is_countersign`]).
    PaperSignature,
}

impl Rule {
    fn needs_body(self) -> bool {
        !matches!(self, Rule::Always(_) | Rule::PaperSignature)
    }

    /// The action of a request, or `None` when it passes.
    pub fn action(self, body: &Value) -> Option<GateAction> {
        let status = body
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or_default();
        match self {
            Rule::Always(action) => Some(action),
            Rule::PaperSignature => Some(GateAction::OrderContractWork),
            Rule::LeadQualify => (status == "qualified").then_some(GateAction::QualifyOrConvert),
            Rule::OrderStatus => (status != "cancelled").then_some(GateAction::OrderContractWork),
            Rule::OrderCommercialBasis => Some(
                if body.get("signed_agency").and_then(Value::as_bool) == Some(true) {
                    GateAction::AgencyCountersign
                } else {
                    GateAction::OrderContractWork
                },
            ),
            Rule::ContractStatus => Some(if status == "signed" {
                GateAction::AgencyCountersign
            } else {
                GateAction::OrderContractWork
            }),
            Rule::QuoteStatus => {
                (!matches!(status, "rejected" | "expired")).then_some(GateAction::OrderContractWork)
            }
            Rule::SignatureRequest => {
                let agency = body
                    .get("signers")
                    .and_then(Value::as_array)
                    .is_some_and(|signers| {
                        signers.iter().any(|signer| {
                            signer.get("role").and_then(Value::as_str) == Some("agency")
                        })
                    });
                Some(if agency {
                    GateAction::AgencyCountersign
                } else {
                    GateAction::OrderContractWork
                })
            }
        }
    }
}

/// Whose request it is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Target {
    Lead(Uuid),
    Patient(Uuid),
    Order(Uuid),
    Contract(Uuid),
    Quote(Uuid),
    Document(Uuid),
    /// Scope from the body: `patient_id`, `source_lead_id` / `lead_id`.
    BodySubjects,
    /// Scope from the body's `document_ids`.
    BodyDocuments,
}

/// Maps a mutating request to its target and rule; `None` = not guarded.
pub fn classify(method: &Method, path: &str) -> Option<(Target, Rule)> {
    if !matches!(
        *method,
        Method::POST | Method::PUT | Method::PATCH | Method::DELETE
    ) {
        return None;
    }
    let path = path.strip_prefix("/api/v1").unwrap_or(path);
    let segments: Vec<&str> = path.trim_matches('/').split('/').collect();
    let id = |value: &str| Uuid::parse_str(value).ok();
    use GateAction::*;
    match segments.as_slice() {
        ["leads", lead, "qualify"] => Some((Target::Lead(id(lead)?), Rule::LeadQualify)),
        ["leads", lead, "convert" | "wizard-convert"] => {
            Some((Target::Lead(id(lead)?), Rule::Always(QualifyOrConvert)))
        }
        ["orders"] if *method == Method::POST => {
            Some((Target::BodySubjects, Rule::Always(OrderContractWork)))
        }
        ["orders", order, rest @ ..] => {
            let order = Target::Order(id(order)?);
            match rest {
                ["status"] => Some((order, Rule::OrderStatus)),
                ["commercial-basis"] => Some((order, Rule::OrderCommercialBasis)),
                // Winding down and bookkeeping stay possible.
                ["external-invoices", ..]
                | ["debt-management"]
                | ["ungroup"]
                | ["leistungen", _, "cancel"] => None,
                [] if *method == Method::DELETE => None,
                [] => Some((order, Rule::Always(OrderContractWork))),
                _ => Some((order, Rule::Always(OrderContractWork))),
            }
        }
        ["patients", patient, "order-intakes"] => Some((
            Target::Patient(id(patient)?),
            Rule::Always(OrderContractWork),
        )),
        ["framework-contracts"] if *method == Method::POST => {
            Some((Target::BodySubjects, Rule::ContractStatus))
        }
        ["framework-contracts", contract, rest @ ..] => {
            let contract = Target::Contract(id(contract)?);
            match rest {
                ["terminate"] => None,
                ["status"] => Some((contract, Rule::ContractStatus)),
                _ => Some((contract, Rule::Always(OrderContractWork))),
            }
        }
        ["quotes", quote, "status"] => Some((Target::Quote(id(quote)?), Rule::QuoteStatus)),
        ["quotes", _] if *method == Method::DELETE => None,
        ["signature-packages"] if *method == Method::POST => {
            Some((Target::BodyDocuments, Rule::SignatureRequest))
        }
        ["documents", document, "signature-requests"] if *method == Method::POST => {
            Some((Target::Document(id(document)?), Rule::SignatureRequest))
        }
        // A signature confirmed by staff ("Подтвердить подпись") is a signature
        // on paper too: the same rule, else it signs past an open or confirmed
        // hit what the scan route refuses (QA 2026-10-10, C3-e).
        ["documents", document, "paper-signature" | "mark-signed"] if *method == Method::POST => {
            Some((Target::Document(id(document)?), Rule::PaperSignature))
        }
        _ => None,
    }
}

fn body_uuid(body: &Value, key: &str) -> Option<Uuid> {
    body.get(key)
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value.trim()).ok())
}

async fn documents_scope(
    db: &gmed_db::DbPool,
    document_ids: &[Uuid],
    scope: &mut Scope,
) -> Result<(), sqlx::Error> {
    if document_ids.is_empty() {
        return Ok(());
    }
    let rows = sqlx::query(
        r#"SELECT d.patient_id, d.lead_id, o.patient_id AS order_patient_id,
                  o.source_lead_id AS order_lead_id
           FROM documents d
           LEFT JOIN orders o ON o.id = d.order_id
           WHERE d.id = ANY($1)"#,
    )
    .bind(document_ids)
    .fetch_all(db)
    .await?;
    for row in rows {
        scope.add_patient(row.try_get("patient_id")?);
        scope.add_lead(row.try_get("lead_id")?);
        scope.add_patient(row.try_get("order_patient_id")?);
        scope.add_lead(row.try_get("order_lead_id")?);
    }
    Ok(())
}

/// The leads and patients of a target.
pub async fn resolve_scope(
    db: &gmed_db::DbPool,
    target: Target,
    body: &Value,
) -> Result<Scope, sqlx::Error> {
    let mut scope = Scope::default();
    match target {
        Target::Lead(lead_id) => scope.add_lead(Some(lead_id)),
        Target::Patient(patient_id) => scope.add_patient(Some(patient_id)),
        Target::Order(order_id) => {
            if let Some(row) =
                sqlx::query("SELECT patient_id, source_lead_id FROM orders WHERE id = $1")
                    .bind(order_id)
                    .fetch_optional(db)
                    .await?
            {
                scope.add_patient(row.try_get("patient_id")?);
                scope.add_lead(row.try_get("source_lead_id")?);
            }
        }
        Target::Contract(contract_id) => {
            if let Some(row) =
                sqlx::query("SELECT patient_id, lead_id FROM framework_contracts WHERE id = $1")
                    .bind(contract_id)
                    .fetch_optional(db)
                    .await?
            {
                scope.add_patient(row.try_get("patient_id")?);
                scope.add_lead(row.try_get("lead_id")?);
            }
        }
        Target::Quote(quote_id) => {
            if let Some(row) = sqlx::query(
                r#"SELECT o.patient_id, o.source_lead_id
                   FROM quotes q JOIN orders o ON o.id = q.order_id
                   WHERE q.id = $1"#,
            )
            .bind(quote_id)
            .fetch_optional(db)
            .await?
            {
                scope.add_patient(row.try_get("patient_id")?);
                scope.add_lead(row.try_get("source_lead_id")?);
            }
        }
        Target::Document(document_id) => documents_scope(db, &[document_id], &mut scope).await?,
        Target::BodySubjects => {
            scope.add_patient(body_uuid(body, "patient_id"));
            scope.add_lead(body_uuid(body, "source_lead_id"));
            scope.add_lead(body_uuid(body, "lead_id"));
        }
        Target::BodyDocuments => {
            let ids: Vec<Uuid> = body
                .get("document_ids")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .filter_map(|value| Uuid::parse_str(value).ok())
                        .collect()
                })
                .unwrap_or_default();
            documents_scope(db, &ids, &mut scope).await?;
        }
    }
    Ok(scope)
}

/// Whether a paper signature of the document is the agency's countersignature:
/// order and contract documents (framework contract, single order, cost
/// coverage declaration) and anything else attached to an order that the
/// agency signs. Consents and the lead's patient form are signed by the
/// patient side only ([`crate::document_signatures::signed_by_patient_side_only`]):
/// their paper signature is the client's own, other work, also when the
/// document names an order (QA 2026-10-10: the blocked-country rule held the
/// client's signature of the patient form).
async fn paper_signature_is_countersign(
    db: &gmed_db::DbPool,
    document_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let Some(row) = sqlx::query(
        r#"SELECT order_id IS NOT NULL AS on_order,
                  generated_template_id, compliance_kind, COALESCE(art, '') AS art
           FROM documents WHERE id = $1"#,
    )
    .bind(document_id)
    .fetch_optional(db)
    .await?
    else {
        return Ok(false);
    };
    let template: Option<String> = row.try_get("generated_template_id")?;
    let compliance_kind: Option<String> = row.try_get("compliance_kind")?;
    let art: String = row.try_get("art")?;
    let on_order: bool = row.try_get("on_order")?;
    Ok(paper_signature_countersigns(
        on_order,
        template.as_deref(),
        compliance_kind.as_deref(),
        &art,
    ))
}

/// The rule of [`paper_signature_is_countersign`] on the document's columns.
fn paper_signature_countersigns(
    on_order: bool,
    template: Option<&str>,
    compliance_kind: Option<&str>,
    art: &str,
) -> bool {
    const CONTRACT_DOCUMENTS: [&str; 3] = [
        "framework_contract",
        "single_order",
        "cost_coverage_declaration",
    ];
    if crate::document_signatures::signed_by_patient_side_only(template, compliance_kind, art) {
        return false;
    }
    on_order
        || template.is_some_and(|template| CONTRACT_DOCUMENTS.contains(&template))
        || CONTRACT_DOCUMENTS.contains(&art)
}

/// The DSGVO consent and the identity document are never held by the
/// sanctions rules (owner decision 2026-10-10): confirming them is no work
/// with the person and no money, and the lead needs them while the CEO decides
/// a match. Paper signature and "mark signed" alike.
fn exempt_from_sanctions_hold(compliance_kind: Option<&str>, art: &str) -> bool {
    matches!(compliance_kind, Some("dsgvo" | "identity"))
        || matches!(
            art.trim().to_lowercase().as_str(),
            "identity" | "passport" | "passport_scan" | "reisepass"
        )
}

async fn paper_signature_exempt(
    db: &gmed_db::DbPool,
    document_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let row: Option<(Option<String>, String)> =
        sqlx::query_as("SELECT compliance_kind, COALESCE(art, '') FROM documents WHERE id = $1")
            .bind(document_id)
            .fetch_optional(db)
            .await?;
    Ok(row.is_some_and(|(kind, art)| exempt_from_sanctions_hold(kind.as_deref(), &art)))
}

/// Middleware on the protected router: blocks guarded requests.
pub async fn middleware(State(state): State<AppState>, request: Request, next: Next) -> Response {
    let Some((target, rule)) = classify(request.method(), request.uri().path()) else {
        return next.run(request).await;
    };
    let needs_body =
        rule.needs_body() || matches!(target, Target::BodySubjects | Target::BodyDocuments);
    let (request, body) = if needs_body {
        let (parts, body) = request.into_parts();
        let bytes = match axum::body::to_bytes(body, MAX_GATE_BODY).await {
            Ok(bytes) => bytes,
            Err(_) => {
                return (
                    StatusCode::PAYLOAD_TOO_LARGE,
                    Json(json!({"error": "payload_too_large", "message": "Request body is too large"})),
                )
                    .into_response();
            }
        };
        let value: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        (Request::from_parts(parts, Body::from(bytes)), value)
    } else {
        (request, Value::Null)
    };
    let Some(action) = rule.action(&body) else {
        return next.run(request).await;
    };
    if let (Rule::PaperSignature, Target::Document(document_id)) = (rule, target)
        && matches!(
            paper_signature_exempt(&state.db, document_id).await,
            Ok(true)
        )
    {
        return next.run(request).await;
    }
    let outcome = async {
        let mut action = action;
        if let (Rule::PaperSignature, Target::Document(document_id)) = (rule, target)
            && paper_signature_is_countersign(&state.db, document_id).await?
        {
            action = GateAction::AgencyCountersign;
        }
        let scope = resolve_scope(&state.db, target, &body).await?;
        let block = evaluate(&state, scope.clone(), action).await?;
        Ok::<_, sqlx::Error>((scope, block, action))
    }
    .await;
    match outcome {
        Ok((_, None, _)) => next.run(request).await,
        Ok((scope, Some(block), action)) => {
            let user_id = request
                .extensions()
                .get::<AuthUser>()
                .map(|auth| auth.user_id);
            let (entity_type, entity_id) = match (scope.lead_ids.first(), scope.patient_ids.first())
            {
                (Some(lead), _) => ("lead", Some(*lead)),
                (None, Some(patient)) => ("patient", Some(*patient)),
                (None, None) => ("lead", None),
            };
            state.audit_sender.try_send(audit::domain_event(
                "sanctions_gate_blocked",
                user_id,
                entity_type,
                entity_id,
                json!({
                    "action": action.as_str(),
                    "block": block.code,
                    "countries": block.countries,
                    "path": request.uri().path(),
                    "method": request.method().as_str(),
                    "lead_ids": scope.lead_ids,
                    "patient_ids": scope.patient_ids,
                }),
            ));
            block.response()
        }
        Err(error) => {
            tracing::error!(error = %error, "Sanctions gate could not evaluate a request");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({
                    "error": "sanctions_gate_unavailable",
                    "message": "The sanctions check is unavailable; try again",
                })),
            )
                .into_response()
        }
    }
}

/// Screening and block state of a lead for the wizard banner.
#[derive(Debug, Clone, Serialize)]
pub struct LeadSanctionsStatus {
    pub lead_id: Uuid,
    pub list_version_date: Option<NaiveDate>,
    pub list_available: bool,
    pub list_stale: bool,
    /// `not_screened` (no list), `clear`, `review_pending`, `confirmed`.
    pub screening: &'static str,
    pub open_hits: i64,
    pub confirmed_hits: i64,
    /// Sanctions block (applies to every guarded action).
    pub sanctions_block: Option<Block>,
    pub country: CountryStatus,
}

#[derive(Debug, Clone, Serialize)]
pub struct CountryStatus {
    pub blocked_countries: Vec<String>,
    /// Blocked codes the lead's subjects have.
    pub found: Vec<String>,
    /// Of those, the codes no lift covers.
    pub blocking: Vec<String>,
    pub lift: Option<CountryOverride>,
}

pub async fn lead_status(
    state: &AppState,
    lead_id: Uuid,
) -> Result<LeadSanctionsStatus, sqlx::Error> {
    let list = super::store::list_status(&state.db).await?;
    let scope = Scope::lead(lead_id).expand(&state.db).await?;
    let (open_hits, confirmed_hits) = hit_counts(&state.db, &scope).await?;
    let blocked = policy::blocked_countries(&state.db).await?;
    let countries = scope_countries(&state.db, &scope).await?;
    let overrides =
        policy::active_overrides(&state.db, &scope.lead_ids, &scope.patient_ids).await?;
    let evaluation = policy::evaluate_countries(&countries, &blocked, &overrides);
    let sanctions_block = if confirmed_hits > 0 {
        Some(Block::sanctions(true))
    } else if open_hits > 0 {
        Some(Block::sanctions(false))
    } else {
        None
    };
    Ok(LeadSanctionsStatus {
        lead_id,
        list_version_date: list.active.as_ref().map(|version| version.list_date),
        list_available: list.active.is_some(),
        list_stale: list.stale,
        screening: if confirmed_hits > 0 {
            "confirmed"
        } else if open_hits > 0 {
            "review_pending"
        } else if list.active.is_some() {
            "clear"
        } else {
            "not_screened"
        },
        open_hits,
        confirmed_hits,
        sanctions_block,
        country: CountryStatus {
            blocked_countries: blocked,
            found: evaluation.found,
            blocking: evaluation.blocking,
            lift: overrides.into_iter().next(),
        },
    })
}

/// A flag for the leads list.
#[derive(Debug, Clone, Serialize)]
pub struct LeadFlag {
    pub lead_id: Uuid,
    /// `confirmed`, `review_pending`, `blocked_country` or `country_lifted`.
    pub flag: &'static str,
}

/// Flags of all open leads with a sanctions or country block.
pub async fn lead_flags(state: &AppState) -> Result<Vec<LeadFlag>, sqlx::Error> {
    let mut flags: Vec<LeadFlag> = Vec::new();
    let rows = sqlx::query(
        r#"SELECT h.lead_id,
                  bool_or(h.status = 'confirmed') AS confirmed,
                  bool_or(h.status = 'open') AS open
           FROM sanctions_hits h
           WHERE h.lead_id IS NOT NULL AND h.status <> 'false_positive'
           GROUP BY h.lead_id"#,
    )
    .fetch_all(&state.db)
    .await?;
    for row in rows {
        let lead_id: Uuid = row.try_get("lead_id")?;
        let confirmed: bool = row
            .try_get::<Option<bool>, _>("confirmed")?
            .unwrap_or(false);
        flags.push(LeadFlag {
            lead_id,
            flag: if confirmed {
                "confirmed"
            } else {
                "review_pending"
            },
        });
    }

    let blocked = policy::blocked_countries(&state.db).await?;
    if blocked.is_empty() {
        return Ok(flags);
    }
    let open_leads: Vec<Uuid> = sqlx::query_scalar(
        r#"SELECT id FROM leads
           WHERE qualification_status NOT IN ('converted', 'deleted')
             AND COALESCE(failed_outcome_status, 'none') <> 'delete_anonymized'"#,
    )
    .fetch_all(&state.db)
    .await?;
    let leads = screening::load_leads_subjects(&state.db, &open_leads).await?;
    let lead_ids: Vec<Uuid> = leads.iter().map(|lead| lead.lead_id).collect();
    let overrides = policy::active_overrides(&state.db, &lead_ids, &[]).await?;
    for lead in leads {
        if flags.iter().any(|flag| flag.lead_id == lead.lead_id) {
            continue;
        }
        let mut countries: Vec<String> = Vec::new();
        for subject in &lead.subjects {
            for code in subject.countries() {
                if !countries.contains(&code) {
                    countries.push(code);
                }
            }
        }
        let lead_overrides: Vec<CountryOverride> = overrides
            .iter()
            .filter(|lift| lift.lead_id == Some(lead.lead_id))
            .cloned()
            .collect();
        let evaluation = policy::evaluate_countries(&countries, &blocked, &lead_overrides);
        if !evaluation.blocking.is_empty() {
            flags.push(LeadFlag {
                lead_id: lead.lead_id,
                flag: "blocked_country",
            });
        } else if !evaluation.found.is_empty() {
            flags.push(LeadFlag {
                lead_id: lead.lead_id,
                flag: "country_lifted",
            });
        }
    }
    Ok(flags)
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: &str = "11111111-2222-3333-4444-555555555555";

    fn uuid() -> Uuid {
        Uuid::parse_str(ID).unwrap()
    }

    fn post(path: &str) -> Option<(Target, Rule)> {
        classify(&Method::POST, &path.replace("{id}", ID))
    }

    #[test]
    fn qualification_and_conversion_are_guarded() {
        assert_eq!(
            post("/leads/{id}/qualify"),
            Some((Target::Lead(uuid()), Rule::LeadQualify))
        );
        assert_eq!(
            post("/api/v1/leads/{id}/convert"),
            Some((
                Target::Lead(uuid()),
                Rule::Always(GateAction::QualifyOrConvert)
            ))
        );
        assert_eq!(
            post("/leads/{id}/wizard-convert"),
            Some((
                Target::Lead(uuid()),
                Rule::Always(GateAction::QualifyOrConvert)
            ))
        );
        // Editing a lead, its prospect and its failed flow stay open.
        assert_eq!(post("/leads/{id}/update"), None);
        assert_eq!(post("/leads/{id}/failed-flow"), None);
        assert_eq!(
            classify(&Method::GET, &format!("/leads/{ID}/qualify")),
            None
        );
    }

    #[test]
    fn countersignature_routes_are_guarded() {
        assert_eq!(
            post("/orders/{id}/commercial-basis"),
            Some((Target::Order(uuid()), Rule::OrderCommercialBasis))
        );
        assert_eq!(
            post("/framework-contracts/{id}/status"),
            Some((Target::Contract(uuid()), Rule::ContractStatus))
        );
        assert_eq!(
            post("/framework-contracts"),
            Some((Target::BodySubjects, Rule::ContractStatus))
        );
        assert_eq!(
            post("/signature-packages"),
            Some((Target::BodyDocuments, Rule::SignatureRequest))
        );
        assert_eq!(
            post("/documents/{id}/signature-requests"),
            Some((Target::Document(uuid()), Rule::SignatureRequest))
        );
        // A signature on paper: the scan is multipart, the document decides.
        assert_eq!(
            post("/documents/{id}/paper-signature"),
            Some((Target::Document(uuid()), Rule::PaperSignature))
        );
        // A signature confirmed by staff follows the same rule.
        assert_eq!(
            post("/documents/{id}/mark-signed"),
            Some((Target::Document(uuid()), Rule::PaperSignature))
        );
        assert!(!Rule::PaperSignature.needs_body());
        // The DSGVO consent and the identity document are never held (owner 2026-10-10).
        assert!(exempt_from_sanctions_hold(Some("dsgvo"), "consent"));
        assert!(exempt_from_sanctions_hold(Some("identity"), ""));
        assert!(exempt_from_sanctions_hold(None, "Passport"));
        assert!(!exempt_from_sanctions_hold(None, "framework_contract"));
        assert!(!exempt_from_sanctions_hold(
            Some("confidentiality_release"),
            "consent"
        ));
        assert_eq!(
            Rule::PaperSignature.action(&Value::Null),
            Some(GateAction::OrderContractWork)
        );
    }

    #[test]
    fn order_and_contract_work_is_guarded_but_winding_down_is_not() {
        for path in [
            "/orders/{id}/phase",
            "/orders/{id}/leistungen",
            "/orders/{id}/leistungen/{id}/deliver",
            "/orders/{id}/quotes",
            "/orders/{id}/payer",
            "/orders/{id}/amendments",
            "/orders/{id}/intake",
            "/framework-contracts/{id}/contracting-party",
        ] {
            assert!(
                matches!(
                    post(path),
                    Some((_, Rule::Always(GateAction::OrderContractWork)))
                ),
                "{path}"
            );
        }
        assert_eq!(
            post("/orders"),
            Some((
                Target::BodySubjects,
                Rule::Always(GateAction::OrderContractWork)
            ))
        );
        assert_eq!(
            post("/patients/{id}/order-intakes"),
            Some((
                Target::Patient(uuid()),
                Rule::Always(GateAction::OrderContractWork)
            ))
        );
        for path in [
            "/orders/{id}/external-invoices",
            "/orders/{id}/external-invoices/{id}/update",
            "/orders/{id}/debt-management",
            "/orders/{id}/ungroup",
            "/orders/{id}/leistungen/{id}/cancel",
            "/framework-contracts/{id}/terminate",
        ] {
            assert_eq!(post(path), None, "{path}");
        }
        assert_eq!(classify(&Method::DELETE, &format!("/quotes/{ID}")), None);
        assert_eq!(post("/patients/{id}/update"), None);
    }

    #[test]
    fn body_rules_pick_the_action() {
        assert_eq!(
            Rule::LeadQualify.action(&json!({"status": "qualified"})),
            Some(GateAction::QualifyOrConvert)
        );
        assert_eq!(
            Rule::LeadQualify.action(&json!({"status": "not_qualified"})),
            None
        );
        assert_eq!(
            Rule::OrderStatus.action(&json!({"status": "cancelled"})),
            None
        );
        assert_eq!(
            Rule::OrderStatus.action(&json!({"status": "active"})),
            Some(GateAction::OrderContractWork)
        );
        assert_eq!(
            Rule::OrderCommercialBasis.action(&json!({"signed_agency": true})),
            Some(GateAction::AgencyCountersign)
        );
        assert_eq!(
            Rule::OrderCommercialBasis.action(&json!({"total_estimated": "100"})),
            Some(GateAction::OrderContractWork)
        );
        assert_eq!(
            Rule::ContractStatus.action(&json!({"status": "signed"})),
            Some(GateAction::AgencyCountersign)
        );
        assert_eq!(
            Rule::QuoteStatus.action(&json!({"status": "rejected"})),
            None
        );
        assert_eq!(
            Rule::QuoteStatus.action(&json!({"status": "accepted"})),
            Some(GateAction::OrderContractWork)
        );
        assert_eq!(
            Rule::SignatureRequest
                .action(&json!({"signers": [{"role": "client"}, {"role": "agency"}]})),
            Some(GateAction::AgencyCountersign)
        );
        assert_eq!(
            Rule::SignatureRequest.action(&json!({"signers": [{"role": "client"}]})),
            Some(GateAction::OrderContractWork)
        );
    }

    #[test]
    fn paper_signature_of_a_patient_side_document_is_not_the_countersignature() {
        // Contract documents and the agency's documents of an order are.
        assert!(paper_signature_countersigns(
            false,
            Some("framework_contract"),
            None,
            "framework_contract"
        ));
        assert!(paper_signature_countersigns(
            false,
            None,
            None,
            "cost_coverage_declaration"
        ));
        assert!(paper_signature_countersigns(true, None, None, "other"));
        // The client's own signature of the patient form or a consent is
        // other work, also when the document names the lead's order.
        assert!(!paper_signature_countersigns(
            true,
            Some("lead_self_disclosure"),
            None,
            "lead_self_disclosure"
        ));
        assert!(!paper_signature_countersigns(
            true,
            Some("privacy_consents"),
            Some("dsgvo"),
            "privacy_consents"
        ));
        assert!(!paper_signature_countersigns(
            false,
            Some("confidentiality_release"),
            None,
            "confidentiality_release"
        ));
    }

    #[test]
    fn block_responses_carry_a_code_and_the_countries() {
        let block = Block::country(vec!["BY".into(), "RU".into()]);
        assert_eq!(block.code, "blocked_country");
        assert!(block.message.contains("BY, RU"));
        assert!(Block::sanctions(true).permanent);
        assert!(!Block::sanctions(false).permanent);
        assert_eq!(Block::sanctions(false).code, "sanctions_review_pending");
    }
}
