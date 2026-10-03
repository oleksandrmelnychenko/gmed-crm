//! Durable signing workflow. Remote mutations are never retried automatically.
pub mod closure;
pub mod connection;
mod create;
mod defaults;
mod effects;
pub(crate) mod frames;
mod legal;
pub(crate) mod package;
mod paper;
pub mod provider;
pub mod retention;
mod review;
mod summary;

#[cfg(test)]
mod tests;

use std::collections::HashMap;

use axum::{
    Extension, Json, Router,
    body::Body,
    extract::{Path, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{Row, postgres::PgRow};
use uuid::Uuid;

use crate::{
    audit,
    auth::middleware::AuthUser,
    file_scan::scan_upload_bytes,
    routes::documents::{self, signature_document_access},
    state::AppState,
};
use provider::{Level, MAX_PDF, Signer, VerifiedRequest, sha256};

pub fn router() -> Router<AppState> {
    Router::new()
        .merge(connection::router())
        .merge(defaults::router())
        .merge(paper::router())
        .merge(review::router())
        .route("/document-signatures/statuses", get(summary::list))
        .route("/documents/{id}/signature-requests", get(list).post(create))
        .route("/signature-packages/candidates", get(create::candidates))
        .route("/signature-packages", post(create::create_package))
        .route("/document-signature-requests/{id}/refresh", post(refresh))
        .route("/document-signature-requests/{id}/withdraw", post(withdraw))
        .route(
            "/document-signature-requests/{id}/abandon",
            post(closure::abandon),
        )
        .route(
            "/document-signature-requests/{id}/resolve-review",
            post(closure::resolve_review),
        )
        .route(
            "/document-signature-requests/{id}/delivered",
            post(closure::record_delivery),
        )
        .route("/document-signature-requests/{id}/report", get(report))
}

fn error(status: StatusCode, code: &str) -> Response {
    (status, Json(json!({"error":code}))).into_response()
}
/// An error about one document of a package, so the composer can mark it.
fn document_error(status: StatusCode, code: &str, document_id: Uuid) -> Response {
    (
        status,
        Json(json!({"error":code,"document_id":document_id})),
    )
        .into_response()
}
fn db_error(error_value: sqlx::Error) -> Response {
    tracing::error!(error = %error_value, "Document signature database operation failed");
    error(
        StatusCode::INTERNAL_SERVER_ERROR,
        "signature_database_error",
    )
}

fn context(row: &PgRow) -> Value {
    json!({"patient_id":row.get::<Option<Uuid>,_>("patient_id"),"lead_id":row.get::<Option<Uuid>,_>("lead_id"),
        "order_id":row.get::<Option<Uuid>,_>("order_id"),"appointment_id":row.get::<Option<Uuid>,_>("appointment_id"),
        "art":row.get::<String,_>("art"),"template":row.get::<Option<String>,_>("generated_template_id"),
        "bindings":row.get::<Option<Value>,_>("generated_bindings"),"storage_key":row.get::<Option<String>,_>("storage_key"),
        "version_root":row.get::<Uuid,_>("version_root_document_id"),"version":row.get::<i32,_>("version_number")})
}

fn eligibility(row: &PgRow) -> Option<&'static str> {
    if row
        .get::<Option<DateTime<Utc>>, _>("file_deleted_at")
        .is_some()
        || row.get::<String, _>("status") == "archived"
    {
        return Some("document_unavailable");
    }
    if !row.get::<bool, _>("is_latest_version") {
        return Some("document_superseded");
    }
    if row.get::<Option<DateTime<Utc>>, _>("signed_at").is_some() {
        return Some("document_already_signed");
    }
    if row.get::<Option<String>, _>("mime_type").as_deref() != Some("application/pdf")
        || row.get::<Option<String>, _>("storage_key").is_none()
    {
        return Some("pdf_required");
    }
    None
}

fn template_of(row: &PgRow) -> Option<String> {
    row.get::<Option<String>, _>("generated_template_id")
}

/// The statute that excludes this document from electronic signing, if any.
fn electronic_form_excluded(row: &PgRow) -> Option<&'static str> {
    legal::electronic_form_excluded(template_of(row).as_deref(), &row.get::<String, _>("art"))
}

fn minimum_level(row: &PgRow) -> Level {
    legal::minimum_level(template_of(row).as_deref(), &row.get::<String, _>("art"))
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum SignerPolicy {
    Flexible,
    ClientOnly,
    AgencyOnly,
    BothParties,
    /// Kostenübernahmeerklärung: the payer (Kostenübernehmer) and GMED.
    PayerAndAgency,
    /// A package with a contract or consent and a cost coverage declaration.
    ClientPayerAndAgency,
}

impl SignerPolicy {
    fn as_str(self) -> &'static str {
        match self {
            Self::Flexible => "flexible",
            Self::ClientOnly => "client_only",
            Self::AgencyOnly => "agency_only",
            Self::BothParties => "both_parties",
            Self::PayerAndAgency => "payer_and_agency",
            Self::ClientPayerAndAgency => "client_payer_and_agency",
        }
    }

    /// The patient side is the client (or every legal representative) plus,
    /// optionally, a minor patient who co-signs; a minor never signs alone.
    /// The payer signs only a cost coverage declaration.
    fn validate(self, signers: &[Signer]) -> Result<(), &'static str> {
        let has = |role: &str| signers.iter().any(|signer| signer.role == role);
        let (has_client, has_agency, has_payer) = (has("client"), has("agency"), has("payer"));
        if has("minor") && !has_client {
            return Err("minor_needs_representative");
        }
        match self {
            Self::Flexible => Ok(()),
            Self::ClientOnly
                if has_client
                    && signers
                        .iter()
                        .all(|signer| provider::is_patient_side(&signer.role)) =>
            {
                Ok(())
            }
            Self::ClientOnly => Err("patient_signature_only"),
            Self::AgencyOnly if signers.iter().all(|signer| signer.role == "agency") => Ok(()),
            Self::AgencyOnly => Err("agency_signature_only"),
            Self::BothParties if has_client && has_agency => Ok(()),
            Self::BothParties => Err("both_contract_parties_required"),
            Self::PayerAndAgency if has_payer && has_agency => Ok(()),
            Self::PayerAndAgency => Err("payer_and_agency_required"),
            Self::ClientPayerAndAgency if has_client && has_payer && has_agency => Ok(()),
            Self::ClientPayerAndAgency => Err("client_payer_and_agency_required"),
        }
    }

    /// One merged PDF has one set of signers, so a package needs what its
    /// strictest member needs. An internal agency-only document is never sent
    /// together with documents for the patient side.
    fn combine(policies: impl IntoIterator<Item = Self>) -> Result<Self, &'static str> {
        let policies: Vec<Self> = policies.into_iter().collect();
        if policies.contains(&Self::AgencyOnly) {
            return if policies.iter().all(|policy| *policy == Self::AgencyOnly) {
                Ok(Self::AgencyOnly)
            } else {
                Err("signature_policy_conflict")
            };
        }
        let needs_payer = policies
            .iter()
            .any(|policy| matches!(policy, Self::PayerAndAgency | Self::ClientPayerAndAgency));
        let needs_client = policies.iter().any(|policy| {
            matches!(
                policy,
                Self::ClientOnly | Self::BothParties | Self::ClientPayerAndAgency
            )
        });
        Ok(match (needs_payer, needs_client) {
            (true, true) => Self::ClientPayerAndAgency,
            (true, false) => Self::PayerAndAgency,
            _ if policies.contains(&Self::BothParties) => Self::BothParties,
            _ if policies.contains(&Self::ClientOnly) => Self::ClientOnly,
            _ => Self::Flexible,
        })
    }
}

fn signer_policy_for_parts(
    generated_template_id: Option<&str>,
    compliance_kind: Option<&str>,
    art: &str,
) -> SignerPolicy {
    if matches!(
        generated_template_id,
        Some("framework_contract" | "single_order")
    ) {
        return SignerPolicy::BothParties;
    }
    if generated_template_id == Some("cost_coverage_declaration")
        || (generated_template_id.is_none() && art == "cost_coverage_declaration")
    {
        return SignerPolicy::PayerAndAgency;
    }
    if matches!(generated_template_id, Some("enhanced_due_diligence"))
        || matches!(compliance_kind, Some("enhanced_due_diligence"))
        || art == "enhanced_due_diligence"
    {
        return SignerPolicy::AgencyOnly;
    }
    if matches!(
        generated_template_id,
        Some(
            "confidentiality_release"
                | "privacy_consents"
                | "consent_data_release_child"
                | "consent_data_release_single"
        )
    ) || matches!(compliance_kind, Some("dsgvo" | "confidentiality_release"))
        || matches!(
            art,
            "confidentiality_release"
                | "privacy_consent"
                | "privacy_consents"
                | "consent_data_release"
        )
    {
        return SignerPolicy::ClientOnly;
    }
    SignerPolicy::Flexible
}

fn signer_policy(row: &PgRow) -> SignerPolicy {
    signer_policy_for_parts(
        row.get::<Option<String>, _>("generated_template_id")
            .as_deref(),
        row.get::<Option<String>, _>("compliance_kind").as_deref(),
        &row.get::<String, _>("art"),
    )
}

fn request_level(row: &PgRow) -> Level {
    row.try_get::<String, _>("level")
        .ok()
        .and_then(|level| Level::parse(&level))
        .unwrap_or_default()
}

/// Documents of a request in bundle order: the source first, then the members.
pub(super) struct BundleEntry {
    pub(super) document_id: Uuid,
    pub(super) position: i16,
    pub(super) page_start: Option<i32>,
    pub(super) page_count: Option<i32>,
    pub(super) result_document_id: Option<Uuid>,
}

async fn bundle_entries<'e, E>(
    executor: E,
    request: &PgRow,
) -> Result<Vec<BundleEntry>, sqlx::Error>
where
    E: sqlx::PgExecutor<'e>,
{
    let members = sqlx::query(
        "SELECT document_id, position, page_start, page_count, result_document_id
         FROM document_signature_members WHERE request_id=$1 ORDER BY position",
    )
    .bind(request.get::<Uuid, _>("id"))
    .fetch_all(executor)
    .await?;
    let is_package = request.try_get::<bool, _>("is_package").unwrap_or(false);
    let mut entries = vec![BundleEntry {
        document_id: request.get("source_document_id"),
        position: 0,
        page_start: request
            .get::<Option<i32>, _>("source_page_count")
            .is_some()
            .then_some(1),
        page_count: request.get("source_page_count"),
        result_document_id: if is_package || !members.is_empty() {
            request.get("result_document_id")
        } else {
            None
        },
    }];
    entries.extend(members.into_iter().map(|member| BundleEntry {
        document_id: member.get("document_id"),
        position: member.get("position"),
        page_start: member.get("page_start"),
        page_count: member.get("page_count"),
        result_document_id: member.get("result_document_id"),
    }));
    Ok(entries)
}

/// Request details for the signature panel. Documents of a package that the
/// viewer may not open are listed without their title.
async fn public_request(
    state: &AppState,
    auth: &AuthUser,
    row: &PgRow,
    access: &mut HashMap<Uuid, bool>,
) -> Result<Value, Response> {
    let id: Uuid = row.get("id");
    let entries = bundle_entries(&state.db, row).await.map_err(db_error)?;
    let ids: Vec<Uuid> = entries.iter().map(|entry| entry.document_id).collect();
    let documents = sqlx::query(
        "SELECT id, auto_name, art, generated_template_id, version_number, is_medical
         FROM documents WHERE id = ANY($1)",
    )
    .bind(&ids)
    .fetch_all(&state.db)
    .await
    .map_err(db_error)?;
    let mut members = Vec::with_capacity(entries.len());
    for entry in &entries {
        let visible = match access.get(&entry.document_id) {
            Some(visible) => *visible,
            None => {
                let visible = signature_document_access(state, auth, entry.document_id, false)
                    .await
                    .is_ok();
                access.insert(entry.document_id, visible);
                visible
            }
        };
        let document = documents
            .iter()
            .find(|document| document.get::<Uuid, _>("id") == entry.document_id);
        members.push(json!({
            "document_id": entry.document_id,
            "position": entry.position,
            "page_start": entry.page_start,
            "page_count": entry.page_count,
            "result_document_id": entry.result_document_id,
            "accessible": visible,
            "title": document.filter(|_| visible).map(|d| d.get::<String, _>("auto_name")),
            "template": document.filter(|_| visible).and_then(|d| d.get::<Option<String>, _>("generated_template_id")),
            "version": document.filter(|_| visible).map(|d| d.get::<i32, _>("version_number")),
        }));
    }
    let attachments = sqlx::query(
        "SELECT a.document_id, a.stage, d.auto_name FROM document_signature_attachments a
         JOIN documents d ON d.id = a.document_id WHERE a.request_id=$1 ORDER BY a.position",
    )
    .bind(id)
    .fetch_all(&state.db)
    .await
    .map_err(db_error)?;
    let mut attachment_values = Vec::with_capacity(attachments.len());
    for attachment in &attachments {
        let document_id: Uuid = attachment.get("document_id");
        let visible = match access.get(&document_id) {
            Some(visible) => *visible,
            None => {
                let visible = signature_document_access(state, auth, document_id, false)
                    .await
                    .is_ok();
                access.insert(document_id, visible);
                visible
            }
        };
        attachment_values.push(json!({
            "document_id": document_id,
            "stage": attachment.get::<String, _>("stage"),
            "title": visible.then(|| attachment.get::<String, _>("auto_name")),
        }));
    }
    let status: String = row.get("status");
    let has_attachments = !attachments.is_empty();
    Ok(json!({"id":id,"status":status,
        "source_document_id":row.get::<Uuid,_>("source_document_id"),
        "test_mode":row.get::<bool,_>("test_mode"),"signers":row.get::<Value,_>("signers"),
        "evidence":row.get::<Value,_>("evidence"),"result_document_id":row.get::<Option<Uuid>,_>("result_document_id"),
        "is_package":row.get::<bool,_>("is_package") || entries.len() > 1,
        "members":members,
        "attachments":attachment_values,
        "level":request_level(row).as_str(),
        "language":row.get::<String,_>("language"),
        "expires_at":row.get::<Option<DateTime<Utc>>,_>("expires_at").map(|value| value.to_rfc3339()),
        "invitation_note":row.get::<Option<String>,_>("invitation_note"),
        "signed_at":row.get::<Option<DateTime<Utc>>,_>("signed_at").map(|value| value.to_rfc3339()),
        "delivered_to_signers_at":row.get::<Option<DateTime<Utc>>,_>("delivered_to_signers_at").map(|value| value.to_rfc3339()),
        "delivery_channel":row.get::<Option<String>,_>("delivery_channel"),
        "has_report":row.get::<Option<String>,_>("report_storage_key").is_some(),
        "can_withdraw":status == "pending" || (status == "submission_unknown" && has_attachments && row.get::<Option<Uuid>,_>("provider_request_id").is_some()),
        "last_error":row.get::<Option<String>,_>("last_error"),
        "can_abandon":closure::can_abandon(&status, row.get("provider_request_id"), row.get::<Option<String>,_>("last_error").as_deref()),
        "can_resolve_review":status == "needs_review",
        "can_record_delivery":status == "completed" && !row.get::<bool,_>("test_mode"),
        "closed_kind":row.get::<Option<String>,_>("closed_kind"),
        "close_reason":row.get::<Option<String>,_>("close_reason"),
        "closed_at":row.get::<Option<DateTime<Utc>>,_>("closed_at").map(|value| value.to_rfc3339()),
        "created_at":row.get::<DateTime<Utc>,_>("created_at").to_rfc3339(),
        "updated_at":row.get::<DateTime<Utc>,_>("updated_at").to_rfc3339()}))
}

async fn list(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, Response> {
    let source = signature_document_access(&state, &auth, id, false).await?;
    let can_send = signature_document_access(&state, &auth, id, true)
        .await
        .is_ok();
    let signer_policy = signer_policy(&source);
    // A signed version displays the history of its source as well.
    let rows = sqlx::query("SELECT r.* FROM document_signature_requests r WHERE source_document_id=$1 OR result_document_id=$1 OR EXISTS(SELECT 1 FROM document_signature_members m WHERE m.request_id=r.id AND (m.document_id=$1 OR m.result_document_id=$1)) ORDER BY created_at DESC LIMIT 30")
        .bind(id).fetch_all(&state.db).await.map_err(db_error)?;
    let provider = connection::current_provider(&state)
        .await
        .map_err(|e| error(StatusCode::SERVICE_UNAVAILABLE, e))?;
    let suggested_signers = if can_send {
        defaults::suggested(&state, &auth, &source, signer_policy).await?
    } else {
        vec![]
    };
    let review_package = if can_send {
        package::options(&state, &auth, &source).await?
    } else {
        Value::Null
    };
    // One entry per document signed together with this one, in bundle order.
    let signing_packages = if can_send {
        package::signing_options(&state, &auth, &source).await?
    } else {
        json!([])
    };
    let mut access = HashMap::new();
    access.insert(id, true);
    let mut requests = Vec::with_capacity(rows.len());
    for row in &rows {
        requests.push(public_request(&state, &auth, row, &mut access).await?);
    }
    let minimum = minimum_level(&source);
    Ok(Json(json!({"enabled":provider.is_some(),"region":"DE",
        "can_configure":auth.can(gmed_domain::access::capabilities::Capability::AdminSignatures),
        "test_mode":provider.as_ref().is_none_or(|p| p.test_mode),"can_send":can_send,
        "signer_policy":signer_policy.as_str(),
        "minimum_level":minimum.as_str(),
        "suggested_signers":suggested_signers,
        "review_package":review_package,
        "signing_packages":signing_packages,
        "scope":{"patient_id":source.get::<Option<Uuid>,_>("patient_id"),"lead_id":source.get::<Option<Uuid>,_>("lead_id")},
        "electronic_form_excluded":electronic_form_excluded(&source),
        "can_sign_on_paper":can_send && paper::possible(&source),
        "ineligible_reason":eligibility(&source).or_else(|| electronic_form_excluded(&source).map(|_| "electronic_form_excluded")),
        "requests":requests})))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CreateRequest {
    signers: Vec<Signer>,
    attachment_document_id: Option<Uuid>,
    #[serde(default)]
    signing_document_ids: Vec<Uuid>,
    level: Option<Level>,
    expires_at: Option<DateTime<Utc>>,
    message: Option<String>,
    language: Option<String>,
}

/// Reads a stored source PDF for sending.
async fn source_bytes(row: &PgRow) -> Result<Vec<u8>, &'static str> {
    current_source_bytes(row)
        .await?
        .ok_or("source_unavailable")
        .and_then(|bytes| {
            if bytes.len() > MAX_PDF || !bytes.starts_with(b"%PDF-") {
                Err("pdf_required")
            } else {
                Ok(bytes)
            }
        })
}

/// The stored bytes of a source, `None` when the document has no usable
/// stored file any more, and an error when storage could not be read; a read
/// error is transient and must be retried, never treated as a changed source.
async fn current_source_bytes(row: &PgRow) -> Result<Option<Vec<u8>>, &'static str> {
    let Some(key) = row.get::<Option<String>, _>("storage_key") else {
        return Ok(None);
    };
    if key.starts_with("demo/") || key.contains("..") || key.contains('\\') || key.starts_with('/')
    {
        return Ok(None);
    }
    documents::read_document_storage_bytes(row.get("id"), &key, Some("application/pdf"), None, None)
        .await
        .map(Some)
        .map_err(|_| "signature_storage_read_error")
}

/// Legacy endpoint: the document itself plus its preset companions. The
/// generic composer uses `POST /signature-packages`.
async fn create(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Json(body): Json<CreateRequest>,
) -> Result<(StatusCode, Json<Value>), Response> {
    let source = signature_document_access(&state, &auth, id, true).await?;
    let mut document_ids = vec![id];
    document_ids.extend(
        package::legacy_signing_order(&state, &auth, &source, &body.signing_document_ids).await?,
    );
    let request_id = create::create_request(
        &state,
        &auth,
        create::Plan {
            document_ids,
            signers: body.signers,
            attachment_ids: body.attachment_document_id.into_iter().collect(),
            level: body.level,
            expires_at: body.expires_at,
            note: body.message,
            language: body.language,
        },
    )
    .await?;
    Ok((StatusCode::ACCEPTED, Json(json!({"id":request_id}))))
}

/// A request is visible to whoever may open any document it covers; mutating
/// it needs edit rights on at least one of them.
async fn authorized_request(
    state: &AppState,
    auth: &AuthUser,
    id: Uuid,
    write: bool,
) -> Result<PgRow, Response> {
    let row = sqlx::query("SELECT * FROM document_signature_requests WHERE id=$1")
        .bind(id)
        .fetch_optional(&state.db)
        .await
        .map_err(db_error)?
        .ok_or_else(|| error(StatusCode::NOT_FOUND, "signature_not_found"))?;
    let entries = bundle_entries(&state.db, &row).await.map_err(db_error)?;
    let mut denied = None;
    for entry in entries {
        match signature_document_access(state, auth, entry.document_id, write).await {
            Ok(_) => return Ok(row),
            Err(response) => {
                denied.get_or_insert(response);
            }
        }
    }
    Err(denied.unwrap_or_else(|| error(StatusCode::FORBIDDEN, "signature_forbidden")))
}

async fn refresh(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, Response> {
    authorized_request(&state, &auth, id, true).await?;
    sqlx::query("UPDATE document_signature_requests SET next_poll_at=now() WHERE id=$1")
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(db_error)?;
    tokio::spawn(async move {
        if let Err(e) = poll_one(&state, Some(id)).await {
            tracing::warn!(code = e, "Signature refresh failed");
        }
    });
    Ok(Json(json!({"ok":true})))
}

async fn withdraw(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, Response> {
    let row = authorized_request(&state, &auth, id, true).await?;
    let provider = connection::current_provider(&state)
        .await
        .map_err(|e| error(StatusCode::SERVICE_UNAVAILABLE, e))?
        .ok_or_else(|| error(StatusCode::SERVICE_UNAVAILABLE, "signature_not_configured"))?;
    if row.get::<String, _>("provider_account") != provider.account {
        return Err(error(StatusCode::CONFLICT, "signature_account_changed"));
    }
    let remote = row
        .get::<Option<Uuid>, _>("provider_request_id")
        .ok_or_else(|| error(StatusCode::CONFLICT, "submission_unknown"))?;
    if row.get::<String, _>("status") != "pending"
        && !(row.get::<String, _>("status") == "submission_unknown"
            && package::has_attachments(&state, id)
                .await
                .map_err(|e| error(StatusCode::INTERNAL_SERVER_ERROR, e))?)
    {
        return Err(error(StatusCode::CONFLICT, "signature_not_pending"));
    }
    provider
        .withdraw(remote)
        .await
        .map_err(|e| error(StatusCode::BAD_GATEWAY, e))?;
    // Withdrawing a signing invitation is a legally relevant remote action:
    // one audit row per document of the request, written together.
    let mut tx = state.db.begin().await.map_err(db_error)?;
    let entries = bundle_entries(&mut *tx, &row).await.map_err(db_error)?;
    for entry in &entries {
        audit::write_in_transaction(
            &mut tx,
            &audit::domain_event(
                "document_signature_withdrawn",
                Some(auth.user_id),
                "document",
                Some(entry.document_id),
                json!({
                    "request_id": id,
                    "position": entry.position,
                    "previous_status": row.get::<String, _>("status"),
                }),
            ),
        )
        .await
        .map_err(db_error)?;
    }
    // Poll authoritative status: the last signer may have completed concurrently.
    sqlx::query("UPDATE document_signature_requests SET next_poll_at=now() WHERE id=$1")
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    tx.commit().await.map_err(db_error)?;
    tokio::spawn(async move {
        let _ = poll_one(&state, Some(id)).await;
    });
    Ok(Json(json!({"ok":true})))
}

async fn report(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Response, Response> {
    let row = authorized_request(&state, &auth, id, false).await?;
    let key = row
        .get::<Option<String>, _>("report_storage_key")
        .ok_or_else(|| error(StatusCode::NOT_FOUND, "signature_report_unavailable"))?;
    let bytes =
        documents::read_document_storage_bytes(id, &key, Some("application/pdf"), None, None)
            .await
            .map_err(|_| error(StatusCode::NOT_FOUND, "signature_report_unavailable"))?;
    Ok((
        [
            (header::CONTENT_TYPE, "application/pdf"),
            (
                header::CONTENT_DISPOSITION,
                "attachment; filename=signature-report.pdf",
            ),
            (header::CACHE_CONTROL, "private, no-store"),
        ],
        Body::from(bytes),
    )
        .into_response())
}

pub fn spawn_worker(state: AppState) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
        loop {
            interval.tick().await;
            // Requests the provider cannot resolve do not stay active forever.
            match closure::close_stuck_requests(&state).await {
                Ok(0) => {}
                Ok(closed) => tracing::info!(closed, "Closed untrackable signature requests"),
                Err(error) => {
                    tracing::warn!(%error, "Closing untrackable signature requests failed")
                }
            }
            for _ in 0..20 {
                match poll_one(&state, None).await {
                    Ok(true) => {}
                    Ok(false) => break,
                    Err(code) => {
                        tracing::warn!(code, "Document signature polling failed");
                        break;
                    }
                }
            }
            match retention::delete_archived_at_provider(&state).await {
                Ok(0) => {}
                Ok(deleted) => {
                    tracing::info!(
                        deleted,
                        "Deleted archived signature requests at the provider"
                    )
                }
                Err(code) => tracing::warn!(code, "Signature provider retention failed"),
            }
        }
    });
}

/// Synchronises one request with the provider now. Integration tests drive
/// the worker step by step with it.
#[doc(hidden)]
pub async fn poll_request_now(state: &AppState, id: Uuid) -> Result<bool, &'static str> {
    sqlx::query("UPDATE document_signature_requests SET next_poll_at=now() WHERE id=$1")
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(|_| "signature_database_error")?;
    poll_one(state, Some(id)).await
}

async fn poll_one(state: &AppState, id: Option<Uuid>) -> Result<bool, &'static str> {
    let Some(provider) = connection::current_provider(state).await? else {
        return Ok(false);
    };
    let token = Uuid::new_v4();
    let row=sqlx::query("UPDATE document_signature_requests SET lease_token=$1,lease_until=now()+interval '10 minutes',status=CASE WHEN status='submitting' THEN 'submission_unknown' ELSE status END WHERE id=(SELECT id FROM document_signature_requests WHERE status IN ('pending','submission_unknown','submitting') AND provider_account=$2 AND ($3::uuid IS NULL OR id=$3) AND next_poll_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY next_poll_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *")
        .bind(token).bind(&provider.account).bind(id).fetch_optional(&state.db).await.map_err(|_|"signature_database_error")?;
    let Some(row) = row else { return Ok(false) };
    let request_id: Uuid = row.get("id");
    if let Err(reason) = sync_claim(state, &row, token).await {
        sqlx::query("UPDATE document_signature_requests SET last_error=$3,lease_until=NULL,lease_token=NULL,next_poll_at=now()+interval '2 minutes',updated_at=now() WHERE id=$1 AND lease_token=$2")
            .bind(request_id).bind(token).bind(reason).execute(&state.db).await.map_err(|_|"signature_database_error")?;
    }
    Ok(true)
}

async fn sync_claim(state: &AppState, row: &PgRow, token: Uuid) -> Result<(), &'static str> {
    let provider = connection::current_provider(state)
        .await?
        .ok_or("signature_not_configured")?;
    let id: Uuid = row.get("id");
    let hash: String = row.get("source_sha256");
    let level = request_level(row);
    let signers: Vec<Signer> =
        serde_json::from_value(row.get("signers")).map_err(|_| "signature_invalid_signers")?;
    let remote_id: Option<Uuid> = row.get("provider_request_id");
    let value = if let Some(remote) = remote_id {
        provider.get(remote).await?
    } else {
        let mut found = provider
            .find(id)
            .await?
            .into_iter()
            .filter(|v| v["custom"] == provider::custom(id, &hash));
        let candidate = found.next().ok_or("submission_unknown")?;
        if found.next().is_some() {
            return Err("provider_duplicate_requests");
        }
        candidate
    };
    let value = package::sync(state, row, &provider, value, &signers).await?;
    let empty_terminal_package = value["signatures"].as_array().is_some_and(|s| s.is_empty())
        && matches!(
            value["status_overall"].as_str(),
            Some("WITHDRAWN" | "DECLINED" | "EXPIRED" | "ERROR")
        )
        && package::has_attachments(state, id).await?;
    let verified = provider.validate_level(
        &value,
        id,
        &hash,
        remote_id,
        if empty_terminal_package {
            &[]
        } else {
            &signers
        },
        level,
    )?;
    sqlx::query("UPDATE document_signature_requests SET provider_request_id=$3,status='pending',evidence=$4 WHERE id=$1 AND lease_token=$2")
        .bind(id).bind(token).bind(verified.id).bind(&verified.evidence).execute(&state.db).await.map_err(|_|"signature_database_error")?;
    if verified.status == "SIGNED" {
        let pdf = provider.pdf(verified.document_id, false).await?;
        let report = provider.pdf(verified.id, true).await?;
        if sha256(&pdf) == hash {
            return Err("provider_unsigned_content");
        }
        scan_upload_bytes(Some("signed.pdf"), &pdf)
            .await
            .map_err(|_| "signature_scan_failed")?;
        scan_upload_bytes(Some("signature-report.pdf"), &report)
            .await
            .map_err(|_| "signature_scan_failed")?;
        archive(state, row, token, &verified, &pdf, &report).await?;
    } else {
        let mut status = match verified.status.as_str() {
            "OPEN" => "pending",
            "DECLINED" => "declined",
            "WITHDRAWN" => "withdrawn",
            "EXPIRED" => "expired",
            _ => "error",
        };
        // The deadline is enforced here, not by the provider: a request still
        // open after `expires_at` is withdrawn there and closed as expired. A
        // failed withdrawal (the last signer may just have signed) is retried
        // with the next poll, which then sees the provider's final status.
        let deadline: Option<DateTime<Utc>> = row.get("expires_at");
        if status == "pending" && deadline.is_some_and(|deadline| deadline <= Utc::now()) {
            provider.withdraw(verified.id).await?;
            status = "expired";
        }
        let previous: String = row.get("status");
        let mut tx = state
            .db
            .begin()
            .await
            .map_err(|_| "signature_database_error")?;
        let updated = sqlx::query("UPDATE document_signature_requests SET status=$3,evidence=$4,last_error=NULL,lease_until=NULL,lease_token=NULL,next_poll_at=now()+interval '1 minute',updated_at=now() WHERE id=$1 AND lease_token=$2")
            .bind(id).bind(token).bind(status).bind(verified.evidence).execute(&mut *tx).await.map_err(|_|"signature_database_error")?;
        // The provider decided (declined, withdrawn, expired, error): record the
        // status change for every document of the request, with the update.
        let terminal = updated.rows_affected() > 0 && previous != status && status != "pending";
        if terminal {
            let entries = bundle_entries(&mut *tx, row)
                .await
                .map_err(|_| "signature_database_error")?;
            for entry in &entries {
                audit::write_in_transaction(
                    &mut tx,
                    &audit::domain_event(
                        "document_signature_status_changed",
                        None,
                        "document",
                        Some(entry.document_id),
                        json!({"request_id": id, "position": entry.position, "previous_status": previous, "status": status}),
                    ),
                )
                .await
                .map_err(|_| "signature_database_error")?;
            }
        }
        tx.commit().await.map_err(|_| "signature_database_error")?;
        if terminal {
            closure::notify_terminal(state, row, status).await;
        }
    }
    Ok(())
}

async fn archive(
    state: &AppState,
    row: &PgRow,
    token: Uuid,
    verified: &VerifiedRequest,
    pdf: &[u8],
    report: &[u8],
) -> Result<(), &'static str> {
    // The signed PDF is stored once, byte for byte as the provider returned it.
    let (_, pdf_key, _) = documents::store_document_blob(pdf, "signed.pdf")
        .await
        .map_err(|_| "signature_storage_error")?;
    let report_key = match documents::store_document_blob(report, "signature-report.pdf").await {
        Ok((_, key, _)) => key,
        Err(_) => {
            documents::remove_document_blob(&pdf_key).await;
            return Err("signature_storage_error");
        }
    };
    let outcome = archive_transaction(
        state,
        row,
        token,
        verified,
        pdf,
        report,
        &pdf_key,
        &report_key,
    )
    .await;
    // A failed COMMIT can have succeeded on PostgreSQL. Keep blobs on any database
    // failure; a retry sees the durable row and cannot delete committed evidence.
    match outcome {
        Ok(ArchiveOutcome::Committed { status, result_id }) => {
            closure::notify_archived(state, row, status, result_id).await;
            Ok(())
        }
        Ok(ArchiveOutcome::Skipped) => {
            documents::remove_document_blob(&pdf_key).await;
            documents::remove_document_blob(&report_key).await;
            Ok(())
        }
        Ok(ArchiveOutcome::Retry(code)) => {
            documents::remove_document_blob(&pdf_key).await;
            documents::remove_document_blob(&report_key).await;
            Err(code)
        }
        Err(code) => Err(code),
    }
}

enum ArchiveOutcome {
    Committed {
        status: &'static str,
        result_id: Uuid,
    },
    /// Another worker archived the request already; nothing was written.
    Skipped,
    /// Rolled back before anything was written; retry later.
    Retry(&'static str),
}

#[allow(clippy::too_many_arguments)]
async fn archive_transaction(
    state: &AppState,
    row: &PgRow,
    token: Uuid,
    verified: &VerifiedRequest,
    pdf: &[u8],
    report: &[u8],
    pdf_key: &str,
    report_key: &str,
) -> Result<ArchiveOutcome, &'static str> {
    let id: Uuid = row.get("id");
    let source_id: Uuid = row.get("source_document_id");
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| "signature_database_error")?;
    let claim=sqlx::query("SELECT * FROM document_signature_requests WHERE id=$1 AND lease_token=$2 AND result_document_id IS NULL FOR UPDATE")
        .bind(id).bind(token).fetch_optional(&mut *tx).await.map_err(|_|"signature_database_error")?;
    let Some(request) = claim else {
        return Ok(ArchiveOutcome::Skipped);
    };
    let source=sqlx::query("SELECT *, NOT EXISTS(SELECT 1 FROM documents v WHERE v.replaces_document_id=d.id) AS is_latest_version FROM documents d WHERE id=$1 FOR UPDATE")
        .bind(source_id).fetch_one(&mut *tx).await.map_err(|_|"signature_database_error")?;
    // A storage read error says nothing about the source: roll back and retry
    // instead of parking a valid signature in review.
    let current = match package::signing_sources_current_in_transaction(&mut tx, row, &source).await
    {
        Ok(current) => current,
        Err(code) => {
            drop(tx);
            return Ok(ArchiveOutcome::Retry(code));
        }
    };
    let test_mode: bool = row.get("test_mode");
    let publish = current && !test_mode;
    let entries = bundle_entries(&mut *tx, &request)
        .await
        .map_err(|_| "signature_database_error")?;
    let is_package = entries.len() > 1;
    let result_id = Uuid::new_v4();
    let signed_at = verified.signed_at.unwrap_or_else(Utc::now);
    if is_package {
        effects::insert_bundle_document(
            &mut tx,
            &request,
            &entries,
            result_id,
            publish,
            test_mode,
            pdf.len() as i64,
            pdf_key,
            signed_at,
        )
        .await?;
        sqlx::query(
            "UPDATE document_signature_members SET result_document_id=$2 WHERE request_id=$1",
        )
        .bind(id)
        .bind(result_id)
        .execute(&mut *tx)
        .await
        .map_err(|_| "signature_database_error")?;
    } else {
        let prefix = if test_mode {
            "TEST – "
        } else if !current {
            "Prüfung erforderlich – "
        } else {
            ""
        };
        sqlx::query(r#"INSERT INTO documents (
            id,patient_id,lead_id,order_id,appointment_id,auto_name,original_filename,
            art,category,status,visibility,is_medical,mime_type,file_size,storage_key,
            klinik,ursprung,notes,generated_template_id,generated_bindings,generated_manual_text,
            document_direction,document_variant,document_language,access_category,document_date,
            source_person,source_institution,addressee_person,addressee_institution,
            financial_status,payment_due_date,payment_date,payment_method,
            version_root_document_id,replaces_document_id,version_number,uploaded_by,signed_at,signed_by)
          SELECT $2,patient_id,lead_id,order_id,appointment_id,$3||auto_name,'signed.pdf',
            CASE WHEN $4 THEN art ELSE 'signature_evidence' END,category,'active',
            CASE WHEN $4 THEN visibility ELSE 'internal' END,is_medical,'application/pdf',$5,$6,
            klinik,'electronic_signature',notes,CASE WHEN $4 THEN generated_template_id ELSE NULL END,
            generated_bindings,generated_manual_text,document_direction,document_variant,document_language,
            access_category,document_date,source_person,source_institution,addressee_person,addressee_institution,
            financial_status,payment_due_date,payment_date,payment_method,
            CASE WHEN $4 THEN version_root_document_id ELSE $2 END,CASE WHEN $4 THEN id ELSE NULL END,
            CASE WHEN $4 THEN version_number+1 ELSE 1 END,$7,CASE WHEN $4 THEN $8::timestamptz ELSE NULL END,NULL
          FROM documents WHERE id=$1"#)
            .bind(source_id).bind(result_id).bind(prefix).bind(publish).bind(pdf.len() as i64).bind(pdf_key).bind(row.get::<Uuid,_>("requested_by"))
            .bind(verified.signed_at).execute(&mut *tx).await.map_err(|_|"signature_database_error")?;
        // Keep a verified live version in the provider cards that hold its source.
        // Test and stale evidence remains separate from those operational documents.
        if publish {
            sqlx::query("INSERT INTO provider_document_links(provider_id,document_id,linked_by) SELECT provider_id,$2,linked_by FROM provider_document_links WHERE document_id=$1 ON CONFLICT DO NOTHING")
                .bind(source_id).bind(result_id).execute(&mut *tx).await.map_err(|_|"signature_database_error")?;
        }
        // Preserve record-level restrictions on the newly archived version.
        sqlx::query("INSERT INTO staff_user_access_rules(user_id,granted_for_role,resource_type,scope_type,resource_id,capability,effect,reason,granted_by,valid_from,valid_until) SELECT user_id,granted_for_role,resource_type,scope_type,$2,capability,effect,reason,granted_by,valid_from,valid_until FROM staff_user_access_rules WHERE resource_type='document' AND resource_id=$1 AND revoked_at IS NULL")
            .bind(source_id).bind(result_id).execute(&mut *tx).await.map_err(|_|"signature_database_error")?;
        sqlx::query("INSERT INTO staff_access_profile_rules(profile_id,resource_type,scope_type,resource_id,capability,effect,created_by) SELECT profile_id,resource_type,scope_type,$2,capability,effect,created_by FROM staff_access_profile_rules WHERE resource_type='document' AND resource_id=$1")
            .bind(source_id).bind(result_id).execute(&mut *tx).await.map_err(|_|"signature_database_error")?;
    }
    // No external shares are created by receiving a signature. Release remains explicit.
    let status = if current { "completed" } else { "needs_review" };
    sqlx::query("UPDATE document_signature_requests SET status=$3,result_document_id=$4,report_storage_key=$5,report_sha256=$6,signed_sha256=$7,evidence=$8,last_error=$9,signed_at=$10,lease_until=NULL,lease_token=NULL,updated_at=now() WHERE id=$1 AND lease_token=$2")
        .bind(id).bind(token).bind(status).bind(result_id).bind(report_key).bind(sha256(report)).bind(sha256(pdf)).bind(&verified.evidence)
        .bind(if current {None}else{Some("document_changed")}).bind(signed_at).execute(&mut *tx).await.map_err(|_|"signature_database_error")?;
    audit::write_in_transaction(
        &mut tx,
        &audit::domain_event(
            "document_signature_archived",
            None,
            "document",
            Some(result_id),
            json!({"request_id":id,"source_document_id":source_id,
                "document_ids":entries.iter().map(|entry| entry.document_id).collect::<Vec<_>>(),
                "test_mode":test_mode,"status":status,"level":request_level(row).as_str(),"sha256":sha256(pdf)}),
        ),
    )
    .await
    .map_err(|_| "signature_database_error")?;
    // Legal effects (contract signed, consents, order signatures) only for a
    // live, verified and current signature. Test results and documents that
    // changed during signing never create them; a review decision may later.
    if publish {
        effects::apply(
            &mut tx,
            &request,
            &entries,
            result_id,
            signed_at,
            &verified.evidence,
        )
        .await?;
    }
    tx.commit().await.map_err(|_| "signature_database_error")?;
    Ok(ArchiveOutcome::Committed { status, result_id })
}
