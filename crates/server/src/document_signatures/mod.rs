//! Durable signing workflow. Remote mutations are never retried automatically.
pub mod connection;
pub mod provider;

#[cfg(test)]
mod tests;

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
use provider::{MAX_PDF, Signer, VerifiedRequest, normalize_signers, sha256};

pub fn router() -> Router<AppState> {
    Router::new()
        .merge(connection::router())
        .route("/documents/{id}/signature-requests", get(list).post(create))
        .route("/document-signature-requests/{id}/refresh", post(refresh))
        .route("/document-signature-requests/{id}/withdraw", post(withdraw))
        .route("/document-signature-requests/{id}/report", get(report))
}

fn error(status: StatusCode, code: &str) -> Response {
    (status, Json(json!({"error":code}))).into_response()
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

fn public_request(row: &PgRow) -> Value {
    json!({"id":row.get::<Uuid,_>("id"),"status":row.get::<String,_>("status"),
        "test_mode":row.get::<bool,_>("test_mode"),"signers":row.get::<Value,_>("signers"),
        "evidence":row.get::<Value,_>("evidence"),"result_document_id":row.get::<Option<Uuid>,_>("result_document_id"),
        "has_report":row.get::<Option<String>,_>("report_storage_key").is_some(),
        "last_error":row.get::<Option<String>,_>("last_error"),
        "created_at":row.get::<DateTime<Utc>,_>("created_at").to_rfc3339()})
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
    // A signed version displays the history of its source as well.
    let rows = sqlx::query("SELECT * FROM document_signature_requests WHERE source_document_id=$1 OR result_document_id=$1 ORDER BY created_at DESC LIMIT 30")
        .bind(id).fetch_all(&state.db).await.map_err(db_error)?;
    let provider = connection::current_provider(&state)
        .await
        .map_err(|e| error(StatusCode::SERVICE_UNAVAILABLE, e))?;
    Ok(Json(json!({"enabled":provider.is_some(),"region":"DE",
        "can_configure":matches!(auth.role,gmed_domain::role::Role::Ceo|gmed_domain::role::Role::ItAdmin),
        "test_mode":provider.as_ref().is_none_or(|p| p.test_mode),"can_send":can_send,
        "ineligible_reason":eligibility(&source),"requests":rows.iter().map(public_request).collect::<Vec<_>>()})))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CreateRequest {
    signers: Vec<Signer>,
}

async fn source_bytes(row: &PgRow) -> Result<Vec<u8>, &'static str> {
    let key = row
        .get::<Option<String>, _>("storage_key")
        .ok_or("source_unavailable")?;
    if key.starts_with("demo/") || key.contains("..") || key.contains('\\') || key.starts_with('/')
    {
        return Err("source_unavailable");
    }
    let bytes = documents::read_document_storage_bytes(
        row.get("id"),
        &key,
        Some("application/pdf"),
        None,
        None,
    )
    .await
    .map_err(|_| "source_unavailable")?;
    if bytes.len() > MAX_PDF || !bytes.starts_with(b"%PDF-") {
        return Err("pdf_required");
    }
    Ok(bytes)
}

async fn create(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Json(body): Json<CreateRequest>,
) -> Result<(StatusCode, Json<Value>), Response> {
    let provider = connection::current_provider(&state)
        .await
        .map_err(|e| error(StatusCode::SERVICE_UNAVAILABLE, e))?
        .ok_or_else(|| error(StatusCode::SERVICE_UNAVAILABLE, "signature_not_configured"))?;
    let source = signature_document_access(&state, &auth, id, true).await?;
    if let Some(reason) = eligibility(&source) {
        return Err(error(StatusCode::CONFLICT, reason));
    }
    let signers =
        normalize_signers(body.signers).map_err(|e| error(StatusCode::UNPROCESSABLE_ENTITY, e))?;
    if matches!(
        source
            .get::<Option<String>, _>("generated_template_id")
            .as_deref(),
        Some("framework_contract" | "single_order")
    ) && !(signers.iter().any(|s| s.role == "client")
        && signers.iter().any(|s| s.role == "agency"))
    {
        return Err(error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "both_contract_parties_required",
        ));
    }
    let bytes = source_bytes(&source)
        .await
        .map_err(|e| error(StatusCode::UNPROCESSABLE_ENTITY, e))?;
    scan_upload_bytes(Some("source.pdf"), &bytes)
        .await
        .map_err(|_| error(StatusCode::UNPROCESSABLE_ENTITY, "signature_scan_failed"))?;
    let request_id = Uuid::new_v4();
    let source_hash = sha256(&bytes);
    // Hold the source row while committing the outbox; confirm it did not change during reading/scanning.
    let mut tx = state.db.begin().await.map_err(db_error)?;
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(connection::CONFIG_LOCK)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    let saved = sqlx::query(
        "SELECT enabled,provider_account FROM signature_provider_connection WHERE singleton=true",
    )
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_error)?;
    if saved.is_some_and(|s| {
        !s.get::<bool, _>("enabled")
            || s.get::<Option<String>, _>("provider_account").as_deref() != Some(&provider.account)
    }) {
        return Err(error(StatusCode::CONFLICT, "signature_account_changed"));
    }
    let current = sqlx::query("SELECT *, NOT EXISTS(SELECT 1 FROM documents v WHERE v.replaces_document_id=d.id) AS is_latest_version FROM documents d WHERE id=$1 FOR UPDATE")
        .bind(id).fetch_one(&mut *tx).await.map_err(db_error)?;
    if eligibility(&current).is_some() || context(&current) != context(&source) {
        return Err(error(StatusCode::CONFLICT, "document_changed"));
    }
    let inserted = sqlx::query("INSERT INTO document_signature_requests (id,source_document_id,requested_by,source_sha256,source_context,signers,provider_account,test_mode,status,lease_until) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'submitting',now()+interval '5 minutes') ON CONFLICT DO NOTHING RETURNING id")
        .bind(request_id).bind(id).bind(auth.user_id).bind(&source_hash).bind(context(&source))
        .bind(json!(signers)).bind(&provider.account).bind(provider.test_mode)
        .fetch_optional(&mut *tx).await.map_err(db_error)?;
    if inserted.is_none() {
        return Err(error(StatusCode::CONFLICT, "signature_already_pending"));
    }
    tx.commit().await.map_err(db_error)?;
    state.audit_sender.try_send(audit::domain_event(
        "document_signature_requested",
        Some(auth.user_id),
        "document",
        Some(id),
        json!({"request_id":request_id,"test_mode":provider.test_mode,"region":"DE"}),
    ));
    // Persist first and respond immediately; a browser disconnect cannot trigger a second invitation.
    tokio::spawn(async move {
        let result = provider
            .create(request_id, &source_hash, &bytes, &signers)
            .await
            .and_then(|v| provider.validate(&v, request_id, &source_hash, None, &signers));
        let (remote, status, reason) = match result {
            Ok(v) => (Some(v.id), "pending", None),
            Err(reason @ ("provider_request_rejected" | "provider_login_failed")) => {
                (None, "error", Some(reason))
            }
            Err(reason) => (None, "submission_unknown", Some(reason)),
        };
        if let Err(e) = sqlx::query("UPDATE document_signature_requests SET provider_request_id=$2,status=$3,last_error=$4,lease_until=NULL,next_poll_at=now(),updated_at=now() WHERE id=$1 AND status='submitting'")
            .bind(request_id).bind(remote).bind(status).bind(reason).execute(&state.db).await {
            tracing::error!(error=%e,request_id=%request_id,"Could not persist signature submission outcome");
        }
    });
    Ok((StatusCode::ACCEPTED, Json(json!({"id":request_id}))))
}

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
    signature_document_access(state, auth, row.get("source_document_id"), write).await?;
    Ok(row)
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
    if row.get::<String, _>("status") != "pending" {
        return Err(error(StatusCode::CONFLICT, "signature_not_pending"));
    }
    provider
        .withdraw(remote)
        .await
        .map_err(|e| error(StatusCode::BAD_GATEWAY, e))?;
    // Poll authoritative status: the last signer may have completed concurrently.
    sqlx::query("UPDATE document_signature_requests SET next_poll_at=now() WHERE id=$1")
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(db_error)?;
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
        }
    });
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
    let verified = provider.validate(&value, id, &hash, remote_id, &signers)?;
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
        let status = match verified.status.as_str() {
            "OPEN" => "pending",
            "DECLINED" => "declined",
            "WITHDRAWN" => "withdrawn",
            "EXPIRED" => "expired",
            _ => "error",
        };
        sqlx::query("UPDATE document_signature_requests SET status=$3,evidence=$4,last_error=NULL,lease_until=NULL,lease_token=NULL,next_poll_at=now()+interval '1 minute',updated_at=now() WHERE id=$1 AND lease_token=$2")
            .bind(id).bind(token).bind(status).bind(verified.evidence).execute(&state.db).await.map_err(|_|"signature_database_error")?;
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
    if let Ok(false) = outcome {
        documents::remove_document_blob(&pdf_key).await;
        documents::remove_document_blob(&report_key).await;
    }
    outcome.map(|_| ())
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
) -> Result<bool, &'static str> {
    let id: Uuid = row.get("id");
    let source_id: Uuid = row.get("source_document_id");
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| "signature_database_error")?;
    let claim=sqlx::query("SELECT id FROM document_signature_requests WHERE id=$1 AND lease_token=$2 AND result_document_id IS NULL FOR UPDATE")
        .bind(id).bind(token).fetch_optional(&mut *tx).await.map_err(|_|"signature_database_error")?;
    if claim.is_none() {
        return Ok(false);
    };
    let source=sqlx::query("SELECT *, NOT EXISTS(SELECT 1 FROM documents v WHERE v.replaces_document_id=d.id) AS is_latest_version FROM documents d WHERE id=$1 FOR UPDATE")
        .bind(source_id).fetch_one(&mut *tx).await.map_err(|_|"signature_database_error")?;
    let current = eligibility(&source).is_none()
        && context(&source) == row.get::<Value, _>("source_context")
        && source_bytes(&source)
            .await
            .is_ok_and(|bytes| sha256(&bytes) == row.get::<String, _>("source_sha256"));
    let test_mode: bool = row.get("test_mode");
    let publish = current && !test_mode;
    let result_id = Uuid::new_v4();
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
    // No external shares are created by receiving a signature. Release remains explicit.
    let status = if current { "completed" } else { "needs_review" };
    sqlx::query("UPDATE document_signature_requests SET status=$3,result_document_id=$4,report_storage_key=$5,report_sha256=$6,signed_sha256=$7,evidence=$8,last_error=$9,lease_until=NULL,lease_token=NULL,updated_at=now() WHERE id=$1 AND lease_token=$2")
        .bind(id).bind(token).bind(status).bind(result_id).bind(report_key).bind(sha256(report)).bind(sha256(pdf)).bind(&verified.evidence)
        .bind(if current {None}else{Some("document_changed")}).execute(&mut *tx).await.map_err(|_|"signature_database_error")?;
    tx.commit().await.map_err(|_| "signature_database_error")?;
    state.audit_sender.try_send(audit::domain_event("document_signature_archived",None,"document",Some(result_id),json!({"request_id":id,"source_document_id":source_id,"test_mode":test_mode,"status":status,"sha256":sha256(pdf)})));
    Ok(true)
}
