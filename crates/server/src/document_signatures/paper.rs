//! A signature given on paper. Staff upload the scan of the signed copy; it
//! becomes the next version of the document, and the document counts as signed
//! with the same effects as after an electronic signature (signed framework
//! contract, order signatures, consents, lead compliance).
//!
//! This is also the only way to record documents the law excludes from the
//! electronic form (§ 766 S. 2 BGB and the like, see `legal.rs`).
use axum::extract::{DefaultBodyLimit, Multipart};

use super::effects::{SignatureSource, SignedDocument, apply_business_effects};
use super::*;
use crate::file_sniff::validate_upload_magic_bytes;
use crate::routes::documents::{
    DocumentSignatureRecord, DocumentSignatureRecordError, MAX_FILE_SIZE,
    compliance_kind_for_signed_document, document_in_active_signature_request,
    record_document_signature_tx, remove_document_blob_checked, store_document_blob,
};

/// `documents.ursprung` of a signed scan.
const ORIGIN: &str = "paper_signature";

pub(super) fn router() -> Router<AppState> {
    Router::new()
        .route("/documents/{id}/paper-signature", post(record))
        .layer(DefaultBodyLimit::max(MAX_FILE_SIZE + 1024 * 1024))
}

/// Why a document cannot be signed on paper right now, if at all.
fn refusal(row: &PgRow) -> Option<(StatusCode, &'static str)> {
    if row
        .get::<Option<DateTime<Utc>>, _>("file_deleted_at")
        .is_some()
        || row.get::<String, _>("status") == "archived"
    {
        return Some((StatusCode::UNPROCESSABLE_ENTITY, "document_unavailable"));
    }
    if !row.get::<bool, _>("is_latest_version") {
        return Some((StatusCode::CONFLICT, "document_superseded"));
    }
    if row.get::<Option<DateTime<Utc>>, _>("signed_at").is_some() {
        return Some((StatusCode::CONFLICT, "document_already_signed"));
    }
    if legal::informational(template_of(row).as_deref()) {
        return Some((
            StatusCode::UNPROCESSABLE_ENTITY,
            "informational_document_not_signable",
        ));
    }
    None
}

/// Whether staff may record a paper signature for this document.
pub(super) fn possible(row: &PgRow) -> bool {
    refusal(row).is_none()
}

/// The signing instant of a date given by staff: now for today, noon German
/// time for an earlier day. A date in the future is refused.
fn signed_instant(signed_on: Option<&str>) -> Result<DateTime<Utc>, Response> {
    let Some(value) = signed_on.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(Utc::now());
    };
    let invalid = || {
        error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "paper_signature_date_invalid",
        )
    };
    let date = chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").map_err(|_| invalid())?;
    let today = crate::app_time::today();
    if date > today {
        return Err(invalid());
    }
    if date == today {
        return Ok(Utc::now());
    }
    Ok(crate::app_time::from_local(
        date.and_time(chrono::NaiveTime::MIN) + chrono::Duration::hours(12),
    ))
}

/// `POST /documents/{id}/paper-signature` (multipart: `file`, optional
/// `signed_on` as `YYYY-MM-DD`): stores the scan as the signed next version of
/// the document.
async fn record(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    mut multipart: Multipart,
) -> Result<Json<Value>, Response> {
    let source = signature_document_access(&state, &auth, id, true).await?;
    if let Some((status, code)) = refusal(&source) {
        return Err(error(status, code));
    }
    if document_in_active_signature_request(&state.db, id)
        .await
        .map_err(db_error)?
    {
        return Err(error(StatusCode::CONFLICT, "signature_already_pending"));
    }
    // A paper-signed contract or order of a lead carries GMED's signature as
    // well: only once the payer declaration is complete (lead_payer.rs).
    crate::routes::lead_payer::check_signature_request(
        &state.db,
        &[crate::routes::lead_payer::SigningDocument {
            template: template_of(&source),
            lead_id: source.get("lead_id"),
            order_id: source.get("order_id"),
        }],
        &["client", "agency"],
    )
    .await?;

    let mut file: Option<(Vec<u8>, String, String)> = None;
    let mut signed_on: Option<String> = None;
    loop {
        let field = match multipart.next_field().await {
            Ok(Some(field)) => field,
            Ok(None) => break,
            Err(_) => {
                return Err(error(
                    StatusCode::BAD_REQUEST,
                    "paper_signature_upload_invalid",
                ));
            }
        };
        match field.name().unwrap_or_default() {
            "file" => {
                let name = field.file_name().unwrap_or("scan").to_string();
                let mime = field
                    .content_type()
                    .unwrap_or("application/octet-stream")
                    .to_string();
                let bytes = field.bytes().await.map_err(|_| {
                    error(
                        StatusCode::PAYLOAD_TOO_LARGE,
                        "paper_signature_scan_too_large",
                    )
                })?;
                file = Some((bytes.to_vec(), name, mime));
            }
            "signed_on" => signed_on = field.text().await.ok(),
            _ => {}
        }
    }
    let Some((data, file_name, declared_mime)) = file.filter(|(data, _, _)| !data.is_empty())
    else {
        return Err(error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "paper_signature_scan_required",
        ));
    };
    if data.len() > MAX_FILE_SIZE {
        return Err(error(
            StatusCode::PAYLOAD_TOO_LARGE,
            "paper_signature_scan_too_large",
        ));
    }
    let wrong_type = || {
        error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "paper_signature_scan_type",
        )
    };
    let mime = validate_upload_magic_bytes(Some(&file_name), Some(&declared_mime), &data)
        .map_err(|_| wrong_type())?
        .unwrap_or(declared_mime);
    if !matches!(
        mime.as_str(),
        "application/pdf" | "image/jpeg" | "image/png"
    ) {
        return Err(wrong_type());
    }
    let signed_at = signed_instant(signed_on.as_deref())?;
    scan_upload_bytes(Some(&file_name), &data)
        .await
        .map_err(|_| error(StatusCode::UNPROCESSABLE_ENTITY, "signature_scan_failed"))?;

    let (file_size, storage_key, original_filename) =
        store_document_blob(&data, &file_name).await?;
    let scan = StoredScan {
        mime: &mime,
        file_size,
        storage_key: &storage_key,
        original_filename: &original_filename,
        sha256: sha256(&data),
    };
    match store_signed_version(&state, &auth, id, &scan, signed_at).await {
        Ok(value) => Ok(Json(value)),
        Err(response) => {
            // The row was not written; do not leave the scan behind.
            if let Err(error) = remove_document_blob_checked(&storage_key).await {
                tracing::error!(%error, document_id = %id, "remove unused paper signature scan");
            }
            Err(response)
        }
    }
}

struct StoredScan<'a> {
    mime: &'a str,
    file_size: i64,
    storage_key: &'a str,
    original_filename: &'a str,
    sha256: String,
}

/// One transaction: the scan as the next version of the document, the
/// signature on it, and what the signature means for the contract, the order,
/// the consents and the lead.
async fn store_signed_version(
    state: &AppState,
    auth: &AuthUser,
    id: Uuid,
    scan: &StoredScan<'_>,
    signed_at: DateTime<Utc>,
) -> Result<Value, Response> {
    let mut tx = state.db.begin().await.map_err(db_error)?;
    let source = sqlx::query(
        "SELECT d.*, NOT EXISTS(SELECT 1 FROM documents v WHERE v.replaces_document_id=d.id) AS is_latest_version
         FROM documents d WHERE id=$1 FOR UPDATE",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_error)?
    .ok_or_else(|| error(StatusCode::NOT_FOUND, "document_unavailable"))?;
    // Somebody may have signed, replaced or sent the document meanwhile.
    if refusal(&source).is_some() {
        return Err(error(StatusCode::CONFLICT, "document_changed"));
    }
    if document_in_active_signature_request(&mut *tx, id)
        .await
        .map_err(db_error)?
    {
        return Err(error(StatusCode::CONFLICT, "signature_already_pending"));
    }

    let signed_id = Uuid::new_v4();
    sqlx::query(
        r#"INSERT INTO documents (
            id,patient_id,lead_id,order_id,appointment_id,auto_name,original_filename,
            art,category,status,visibility,is_medical,mime_type,file_size,storage_key,
            klinik,ursprung,notes,generated_template_id,generated_bindings,generated_manual_text,
            document_direction,document_variant,document_language,access_category,document_date,
            source_person,source_institution,addressee_person,addressee_institution,
            financial_status,payment_due_date,payment_date,payment_method,
            version_root_document_id,replaces_document_id,version_number,uploaded_by)
          SELECT $2,patient_id,lead_id,order_id,appointment_id,auto_name,$3,
            art,category,'active',visibility,is_medical,$4,$5,$6,
            klinik,$7,notes,generated_template_id,generated_bindings,generated_manual_text,
            document_direction,document_variant,document_language,access_category,document_date,
            source_person,source_institution,addressee_person,addressee_institution,
            financial_status,payment_due_date,payment_date,payment_method,
            version_root_document_id,id,version_number+1,$8
          FROM documents WHERE id=$1"#,
    )
    .bind(id)
    .bind(signed_id)
    .bind(scan.original_filename)
    .bind(scan.mime)
    .bind(scan.file_size)
    .bind(scan.storage_key)
    .bind(ORIGIN)
    .bind(auth.user_id)
    .execute(&mut *tx)
    .await
    .map_err(db_error)?;
    // The signed version stays in the provider cards and under the record-level
    // restrictions of the version it replaces, like an electronically signed one.
    sqlx::query("INSERT INTO provider_document_links(provider_id,document_id,linked_by) SELECT provider_id,$2,linked_by FROM provider_document_links WHERE document_id=$1 ON CONFLICT DO NOTHING")
        .bind(id).bind(signed_id).execute(&mut *tx).await.map_err(db_error)?;
    sqlx::query("INSERT INTO staff_user_access_rules(user_id,granted_for_role,resource_type,scope_type,resource_id,capability,effect,reason,granted_by,valid_from,valid_until) SELECT user_id,granted_for_role,resource_type,scope_type,$2,capability,effect,reason,granted_by,valid_from,valid_until FROM staff_user_access_rules WHERE resource_type='document' AND resource_id=$1 AND revoked_at IS NULL")
        .bind(id).bind(signed_id).execute(&mut *tx).await.map_err(db_error)?;
    sqlx::query("INSERT INTO staff_access_profile_rules(profile_id,resource_type,scope_type,resource_id,capability,effect,created_by) SELECT profile_id,resource_type,scope_type,$2,capability,effect,created_by FROM staff_access_profile_rules WHERE resource_type='document' AND resource_id=$1")
        .bind(id).bind(signed_id).execute(&mut *tx).await.map_err(db_error)?;

    let template = template_of(&source);
    let art: String = source.get("art");
    let patient_id: Option<Uuid> = source.get("patient_id");
    let lead_id: Option<Uuid> = source.get("lead_id");
    let order_id: Option<Uuid> = source.get("order_id");
    let kind = compliance_kind_for_signed_document(template.as_deref(), &art);
    match kind {
        Some(kind) => {
            match record_document_signature_tx(
                &mut tx,
                &DocumentSignatureRecord {
                    document_id: signed_id,
                    patient_id,
                    lead_id,
                    compliance_kind: kind,
                    signed_at,
                    signed_by: Some(auth.user_id),
                    actor_id: auth.user_id,
                    consent_context: json!({
                        "source": ORIGIN,
                        "replaced_document_id": id,
                        "scan_sha256": scan.sha256,
                    }),
                    converted_lead_is_error: false,
                },
            )
            .await
            {
                Ok(_) | Err(DocumentSignatureRecordError::ConvertedLead) => {}
                Err(DocumentSignatureRecordError::Database(error)) => return Err(db_error(error)),
            }
        }
        None => {
            sqlx::query(
                "UPDATE documents SET signed_at=$2, signed_by=$3, updated_at=now() WHERE id=$1",
            )
            .bind(signed_id)
            .bind(signed_at)
            .bind(auth.user_id)
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
        }
    }

    let mut effects = json!({
        "source": ORIGIN,
        "signed_document_id": signed_id,
        "replaced_document_id": id,
        "compliance_kind": kind,
        "signed_at": signed_at.to_rfc3339(),
        "scan_sha256": scan.sha256,
    });
    // A paper copy carries every signature the document needs.
    apply_business_effects(
        &mut tx,
        &SignedDocument {
            document_id: signed_id,
            template: template.as_deref(),
            art: &art,
            patient_id,
            lead_id,
            order_id,
        },
        signed_at,
        &SignatureSource {
            name: ORIGIN,
            request_id: None,
            actor: Some(auth.user_id),
        },
        true,
        true,
        &mut effects,
    )
    .await
    .map_err(|code| error(StatusCode::INTERNAL_SERVER_ERROR, code))?;
    audit::write_in_transaction(
        &mut tx,
        &audit::domain_event(
            "document_paper_signature_recorded",
            Some(auth.user_id),
            "document",
            Some(signed_id),
            effects,
        ),
    )
    .await
    .map_err(db_error)?;
    tx.commit().await.map_err(db_error)?;

    Ok(json!({
        "ok": true,
        "document_id": signed_id,
        "replaced_document_id": id,
        "signed_at": signed_at.to_rfc3339(),
        "compliance_kind": kind,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_paper_signature_is_dated_today_or_earlier() {
        let today = crate::app_time::today();
        assert!(signed_instant(None).is_ok());
        assert!(signed_instant(Some("  ")).is_ok());
        assert!(signed_instant(Some(&today.to_string())).is_ok());
        let earlier = today - chrono::Duration::days(3);
        let instant = signed_instant(Some(&earlier.to_string())).unwrap();
        assert_eq!(crate::app_time::date_of(instant), earlier);
        let tomorrow = today + chrono::Duration::days(1);
        assert!(signed_instant(Some(&tomorrow.to_string())).is_err());
        assert!(signed_instant(Some("03.10.2026")).is_err());
    }
}
