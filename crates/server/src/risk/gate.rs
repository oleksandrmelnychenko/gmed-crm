//! The risk gate (contract 5): a lead whose assessment is level ≥ 2 and not
//! released — or that staff rejected — waits for the staff decision before
//! qualification, conversion, the documents for signature (the DSGVO consent
//! stays signable, else the 14-day retention purges held leads), the agency
//! countersignature of a framework contract or an order and the payer's
//! signature package. At level 3 the payer's link waits too, unless staff
//! requested block D. Drafting (orders, quotes, prepare) stays open; nothing
//! is ever rejected or cancelled by the gate (P1).
//!
//! The gate first reassesses the lead (cause `gate`); a lead that is neither
//! started nor grandfathered is started by its first gated call, so a lead
//! staff work without a cabinet submit is scored too. It is one middleware
//! on the protected router, right after the sanctions gate, and reuses its
//! route map ([`crate::sanctions::gate::classify`]).

use axum::{
    Json,
    body::Body,
    extract::{Request, State},
    http::{Method, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use serde_json::{Value, json};
use sqlx::Row;
use uuid::Uuid;

use super::store::{self, Cause};
use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::sanctions::gate::{self as sanctions_gate, GateAction, Rule, Scope, Target};
use crate::state::AppState;

/// Largest JSON body the gate reads (the axum default limit).
const MAX_GATE_BODY: usize = 2 * 1024 * 1024;

pub const ERROR_CODE: &str = "risk_review_required";

/// A route the risk gate guards.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RiskRoute {
    /// A route of the sanctions gate's map, judged by its rule.
    Mapped(Target, Rule),
    /// `POST /leads/{id}/payer-signature-package/send`.
    PayerPackageSend(Uuid),
    /// `POST /leads/{id}/payer-link` (level 3 only, unless D was requested).
    PayerLink(Uuid),
}

/// Maps a request to the risk gate; `None` = not guarded.
pub fn classify(method: &Method, path: &str) -> Option<RiskRoute> {
    if *method != Method::POST {
        return None;
    }
    let trimmed = path.strip_prefix("/api/v1").unwrap_or(path);
    let segments: Vec<&str> = trimmed.trim_matches('/').split('/').collect();
    match segments.as_slice() {
        ["leads", lead, "payer-signature-package", "send"] => {
            return Uuid::parse_str(lead).ok().map(RiskRoute::PayerPackageSend);
        }
        ["leads", lead, "payer-link"] => {
            return Uuid::parse_str(lead).ok().map(RiskRoute::PayerLink);
        }
        // A signature confirmed by staff is a paper signature too (QA 2026-10-10);
        // the DSGVO consent stays open here (`document_leads`). The sanctions
        // gate maps the route itself (same rule as `paper-signature`).
        ["documents", document, "mark-signed"] => {
            return Uuid::parse_str(document)
                .ok()
                .map(|id| RiskRoute::Mapped(Target::Document(id), Rule::PaperSignature));
        }
        _ => {}
    }
    let (target, rule) = sanctions_gate::classify(method, path)?;
    let guarded = matches!(
        rule,
        Rule::LeadQualify
            | Rule::Always(GateAction::QualifyOrConvert)
            | Rule::SignatureRequest
            | Rule::PaperSignature
            | Rule::ContractStatus
            | Rule::OrderCommercialBasis
    );
    guarded.then_some(RiskRoute::Mapped(target, rule))
}

impl RiskRoute {
    fn needs_body(self) -> bool {
        match self {
            RiskRoute::Mapped(target, rule) => {
                !matches!(rule, Rule::Always(_) | Rule::PaperSignature)
                    || matches!(target, Target::BodySubjects | Target::BodyDocuments)
            }
            _ => false,
        }
    }

    /// Whether the request is a guarded action at all (body rules).
    fn applies(self, body: &Value) -> bool {
        match self {
            RiskRoute::Mapped(_, rule @ (Rule::LeadQualify | Rule::Always(_))) => {
                rule.action(body) == Some(GateAction::QualifyOrConvert)
            }
            RiskRoute::Mapped(_, rule @ (Rule::ContractStatus | Rule::OrderCommercialBasis)) => {
                rule.action(body) == Some(GateAction::AgencyCountersign)
            }
            _ => true,
        }
    }
}

/// The leads of documents that are not the DSGVO consent.
async fn document_leads(db: &gmed_db::DbPool, document_ids: &[Uuid]) -> Result<Scope, sqlx::Error> {
    let mut scope = Scope::default();
    if document_ids.is_empty() {
        return Ok(scope);
    }
    let rows = sqlx::query(
        r#"SELECT d.lead_id, o.source_lead_id, d.patient_id, o.patient_id AS order_patient_id
           FROM documents d
           LEFT JOIN orders o ON o.id = d.order_id
           WHERE d.id = ANY($1)
             AND COALESCE(d.compliance_kind, '') <> 'dsgvo'"#,
    )
    .bind(document_ids)
    .fetch_all(db)
    .await?;
    for row in rows {
        for column in ["lead_id", "source_lead_id"] {
            if let Some(id) = row.try_get::<Option<Uuid>, _>(column)?
                && !scope.lead_ids.contains(&id)
            {
                scope.lead_ids.push(id);
            }
        }
        for column in ["patient_id", "order_patient_id"] {
            if let Some(id) = row.try_get::<Option<Uuid>, _>(column)?
                && !scope.patient_ids.contains(&id)
            {
                scope.patient_ids.push(id);
            }
        }
    }
    Ok(scope)
}

async fn scope_of(
    state: &AppState,
    route: RiskRoute,
    body: &Value,
) -> Result<Vec<Uuid>, sqlx::Error> {
    let scope = match route {
        RiskRoute::PayerPackageSend(lead) | RiskRoute::PayerLink(lead) => Scope::lead(lead),
        RiskRoute::Mapped(Target::Document(document), _) => {
            document_leads(&state.db, &[document]).await?
        }
        RiskRoute::Mapped(Target::BodyDocuments, _) => {
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
            document_leads(&state.db, &ids).await?
        }
        RiskRoute::Mapped(target, _) => {
            sanctions_gate::resolve_scope(&state.db, target, body).await?
        }
    };
    if scope.is_empty() {
        return Ok(Vec::new());
    }
    // The open lead of a patient (repeat intake) and the lead a patient came
    // from count too.
    let scope = scope.expand(&state.db).await?;
    // Deleted leads are never held.
    let leads: Vec<Uuid> = sqlx::query_scalar(
        "SELECT id FROM leads WHERE id = ANY($1) AND qualification_status <> 'deleted' ORDER BY id",
    )
    .bind(&scope.lead_ids)
    .fetch_all(&state.db)
    .await?;
    Ok(leads)
}

/// Whether the assessment of `lead_id` holds `route` (after starting or
/// reassessing it).
pub async fn holds(
    state: &AppState,
    lead_id: Uuid,
    route: RiskRoute,
    actor: Option<Uuid>,
) -> Result<bool, sqlx::Error> {
    let mut tx = state.db.begin().await?;
    let assessment = store::ensure_started(&mut tx, lead_id, Cause::Gate, actor).await?;
    tx.commit().await?;
    let Some(assessment) = assessment else {
        return Ok(false);
    };
    Ok(match route {
        RiskRoute::PayerLink(_) => assessment.holds_payer_link(),
        _ => assessment.holds(),
    })
}

/// The refusal; after a reject it says so (QA 2026-10-10: it still read
/// "waits for a staff decision").
fn blocked(rejected: bool) -> Response {
    let message = if rejected {
        "The risk assessment of this lead was rejected"
    } else {
        "The risk assessment of this lead waits for a staff decision"
    };
    (
        StatusCode::CONFLICT,
        Json(json!({
            "error": ERROR_CODE,
            "code": ERROR_CODE,
            "message": message,
            "rejected": rejected,
        })),
    )
        .into_response()
}

/// Middleware on the protected router (after the sanctions gate).
pub async fn middleware(State(state): State<AppState>, request: Request, next: Next) -> Response {
    let Some(route) = classify(request.method(), request.uri().path()) else {
        return next.run(request).await;
    };
    let (request, body) = if route.needs_body() {
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
    if !route.applies(&body) {
        return next.run(request).await;
    }
    let actor = request
        .extensions()
        .get::<AuthUser>()
        .map(|auth| auth.user_id);
    let outcome = async {
        let mut held = Vec::new();
        for lead_id in scope_of(&state, route, &body).await? {
            if holds(&state, lead_id, route, actor).await? {
                held.push(lead_id);
            }
        }
        Ok::<_, sqlx::Error>(held)
    }
    .await;
    match outcome {
        Ok(held) if held.is_empty() => next.run(request).await,
        Ok(held) => {
            state.audit_sender.try_send(audit::domain_event(
                "risk_gate_blocked",
                actor,
                "lead",
                held.first().copied(),
                json!({
                    "path": request.uri().path(),
                    "method": request.method().as_str(),
                    "lead_ids": held,
                }),
            ));
            let rejected = sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS (SELECT 1 FROM lead_risk_assessments WHERE lead_id = ANY($1) AND status = $2)",
            )
            .bind(&held)
            .bind(store::STATUS_REJECTED)
            .fetch_one(&state.db)
            .await
            .unwrap_or(false);
            blocked(rejected)
        }
        Err(error) => {
            tracing::error!(error = %error, "Risk gate could not evaluate a request");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({
                    "error": "risk_gate_unavailable",
                    "message": "The risk assessment is unavailable; try again",
                })),
            )
                .into_response()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: &str = "11111111-2222-3333-4444-555555555555";

    fn post(path: &str) -> Option<RiskRoute> {
        classify(&Method::POST, &path.replace("{id}", ID))
    }

    #[test]
    fn the_guarded_routes_are_pinned() {
        let id = Uuid::parse_str(ID).unwrap();
        for path in [
            "/leads/{id}/qualify",
            "/leads/{id}/convert",
            "/api/v1/leads/{id}/wizard-convert",
            "/signature-packages",
            "/documents/{id}/signature-requests",
            "/documents/{id}/paper-signature",
            "/documents/{id}/mark-signed",
            "/framework-contracts/{id}/status",
            "/framework-contracts",
            "/orders/{id}/commercial-basis",
        ] {
            assert!(post(path).is_some(), "{path}");
        }
        assert_eq!(
            post("/leads/{id}/payer-signature-package/send"),
            Some(RiskRoute::PayerPackageSend(id))
        );
        assert_eq!(
            post("/leads/{id}/payer-link"),
            Some(RiskRoute::PayerLink(id))
        );
        // Drafting stays open.
        for path in [
            "/orders",
            "/orders/{id}/quotes",
            "/orders/{id}/status",
            "/leads/{id}/payer-signature-package/prepare",
            "/leads/{id}/payer-link/revoke",
            "/leads/{id}/update",
            "/framework-contracts/{id}/terminate",
        ] {
            assert_eq!(post(path), None, "{path}");
        }
        assert_eq!(
            classify(&Method::GET, &format!("/leads/{ID}/payer-link")),
            None
        );
    }

    #[test]
    fn body_rules_decide_whether_the_gate_applies() {
        let qualify = post("/leads/{id}/qualify").unwrap();
        assert!(qualify.applies(&json!({"status": "qualified"})));
        assert!(!qualify.applies(&json!({"status": "not_qualified"})));
        let contract = post("/framework-contracts/{id}/status").unwrap();
        assert!(contract.applies(&json!({"status": "signed"})));
        assert!(!contract.applies(&json!({"status": "sent"})));
        let order = post("/orders/{id}/commercial-basis").unwrap();
        assert!(order.applies(&json!({"signed_agency": true})));
        assert!(!order.applies(&json!({"total_estimated": "10"})));
        let convert = post("/leads/{id}/convert").unwrap();
        assert!(convert.applies(&Value::Null));
        let signature = post("/documents/{id}/signature-requests").unwrap();
        assert!(signature.applies(&json!({"signers": [{"role": "client"}]})));
    }
}
