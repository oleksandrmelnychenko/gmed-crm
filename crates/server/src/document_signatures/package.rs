//! Prepare a non-signing attachment before inviting anyone. Each remote mutation
//! has a durable phase; ambiguous writes are reconciled, never blindly replayed.
use super::*;
use printpdf::{PdfDocument, PdfParseOptions, PdfSaveOptions};

pub(super) fn companion(template: Option<&str>) -> Option<&'static str> {
    match template {
        Some("framework_contract") => Some("privacy_information"),
        Some("confidentiality_release") => Some("privacy_information"),
        Some("order_cost_estimate") => Some("cost_estimate"),
        _ => None,
    }
}

/// Documents signed together with the source as one PDF, in bundle order.
///
/// During lead intake the framework contract carries the whole onboarding
/// package: the client gets one invitation for the contract, the order and both
/// consents, signs first, and the agency is invited afterwards. Outside intake a
/// contract or an order is still signed on its own.
pub(super) fn signing_companions(
    template: Option<&str>,
    lead_intake: bool,
) -> &'static [&'static str] {
    match template {
        Some("framework_contract") if lead_intake => &[
            "single_order",
            "confidentiality_release",
            "privacy_consents",
        ],
        Some("confidentiality_release") => &["privacy_consents"],
        _ => &[],
    }
}

/// A lead's documents belong to no patient until the lead is converted.
fn is_lead_intake(source: &PgRow) -> bool {
    source.get::<Option<Uuid>, _>("lead_id").is_some()
        && source.get::<Option<Uuid>, _>("patient_id").is_none()
}

fn source_signing_companions(source: &PgRow) -> &'static [&'static str] {
    signing_companions(
        source
            .get::<Option<String>, _>("generated_template_id")
            .as_deref(),
        is_lead_intake(source),
    )
}

fn same_scope(source: &PgRow, candidate: &PgRow) -> bool {
    let lead: Option<Uuid> = source.get("lead_id");
    let patient: Option<Uuid> = source.get("patient_id");
    let order: Option<Uuid> = source.get("order_id");
    let identity = if let Some(lead) = lead {
        candidate.get::<Option<Uuid>, _>("lead_id") == Some(lead)
            && patient
                .zip(candidate.get::<Option<Uuid>, _>("patient_id"))
                .is_none_or(|(a, b)| a == b)
    } else {
        patient.is_some() && candidate.get::<Option<Uuid>, _>("patient_id") == patient
    };
    identity
        && (companion(
            source
                .get::<Option<String>, _>("generated_template_id")
                .as_deref(),
        ) != Some("cost_estimate")
            || order.is_some() && candidate.get::<Option<Uuid>, _>("order_id") == order)
}

pub(super) async fn options(
    state: &AppState,
    auth: &AuthUser,
    source: &PgRow,
) -> Result<Value, Response> {
    let Some(template) = companion(
        source
            .get::<Option<String>, _>("generated_template_id")
            .as_deref(),
    ) else {
        return Ok(Value::Null);
    };
    let ids: Vec<Uuid> = sqlx::query_scalar(
        "SELECT id FROM documents WHERE generated_template_id=$1 AND file_deleted_at IS NULL AND status<>'archived'
         AND (($2::uuid IS NOT NULL AND lead_id=$2) OR ($2::uuid IS NULL AND $3::uuid IS NOT NULL AND patient_id=$3))
         ORDER BY created_at DESC,id DESC LIMIT 100"
    ).bind(template).bind(source.get::<Option<Uuid>,_>("lead_id")).bind(source.get::<Option<Uuid>,_>("patient_id"))
        .fetch_all(&state.db).await.map_err(db_error)?;
    let mut choices = Vec::new();
    for id in ids {
        if let Ok(row) = signature_document_access(state, auth, id, false).await
            && same_scope(source, &row)
            && eligibility(&row).is_none()
        {
            choices.push(json!({"id":id,"title":row.get::<String,_>("auto_name"),"version":row.get::<i32,_>("version_number")}));
        }
    }
    Ok(json!({"template":template,"documents":choices}))
}

/// One entry per companion template, in bundle order; an entry without documents
/// tells the client which document still has to be created.
pub(super) async fn signing_options(
    state: &AppState,
    auth: &AuthUser,
    source: &PgRow,
) -> Result<Value, Response> {
    let mut packages = Vec::new();
    for template in source_signing_companions(source) {
        let ids: Vec<Uuid> = sqlx::query_scalar(
            "SELECT id FROM documents WHERE generated_template_id=$1 AND file_deleted_at IS NULL AND status<>'archived'
             AND (($2::uuid IS NOT NULL AND lead_id=$2) OR ($2::uuid IS NULL AND $3::uuid IS NOT NULL AND patient_id=$3))
             ORDER BY created_at DESC,id DESC LIMIT 100"
        ).bind(template).bind(source.get::<Option<Uuid>,_>("lead_id")).bind(source.get::<Option<Uuid>,_>("patient_id"))
            .fetch_all(&state.db).await.map_err(db_error)?;
        let mut choices = Vec::new();
        for id in ids {
            if let Ok(row) = signature_document_access(state, auth, id, false).await
                && same_scope(source, &row)
                && eligibility(&row).is_none()
            {
                choices.push(json!({"id":id,"title":row.get::<String,_>("auto_name"),"version":row.get::<i32,_>("version_number")}));
            }
        }
        packages.push(json!({"template":template,"documents":choices}));
    }
    Ok(Value::Array(packages))
}

pub(super) struct Prepared {
    row: PgRow,
    hash: String,
    filename: String,
}

pub(super) struct PreparedSigningMember {
    pub(super) row: PgRow,
    pub(super) hash: String,
    pub(super) bytes: Vec<u8>,
}

/// Resolve the selected documents into the bundle's members, one per companion
/// template and in bundle order. The members are not scanned one by one: the
/// merged bundle, which contains every page of them and is what leaves the
/// system, is scanned as a whole.
pub(super) async fn prepare_signing_members(
    state: &AppState,
    auth: &AuthUser,
    source: &PgRow,
    selected: &[Uuid],
) -> Result<Vec<PreparedSigningMember>, Response> {
    let required = source_signing_companions(source);
    let mut rows = Vec::with_capacity(selected.len());
    for id in selected {
        rows.push(signature_document_access(state, auth, *id, false).await?);
    }
    let template_of = |row: &PgRow| row.get::<Option<String>, _>("generated_template_id");
    if rows.iter().any(|row| {
        !template_of(row)
            .as_deref()
            .is_some_and(|template| required.contains(&template))
    }) || rows.len() > required.len()
    {
        return Err(error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "unexpected_signing_document",
        ));
    }
    let mut members = Vec::with_capacity(required.len());
    for template in required {
        let position = rows
            .iter()
            .position(|row| template_of(row).as_deref() == Some(*template))
            .ok_or_else(|| {
                error(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "signing_document_required",
                )
            })?;
        let row = rows.swap_remove(position);
        if !same_scope(source, &row) || eligibility(&row).is_some() {
            return Err(error(StatusCode::CONFLICT, "signing_document_changed"));
        }
        let bytes = source_bytes(&row)
            .await
            .map_err(|e| error(StatusCode::UNPROCESSABLE_ENTITY, e))?;
        members.push(PreparedSigningMember {
            hash: sha256(&bytes),
            row,
            bytes,
        });
    }
    Ok(members)
}

pub(super) fn merge_signing_pdfs(
    primary: &[u8],
    members: &[&[u8]],
) -> Result<Vec<u8>, &'static str> {
    if members.is_empty() {
        return Ok(primary.to_vec());
    }
    let mut warnings = Vec::new();
    let mut document = PdfDocument::parse(primary, &PdfParseOptions::default(), &mut warnings)
        .map_err(|_| "signature_bundle_invalid_pdf")?;
    for member in members {
        let additional = PdfDocument::parse(member, &PdfParseOptions::default(), &mut warnings)
            .map_err(|_| "signature_bundle_invalid_pdf")?;
        document.append_document(additional);
    }
    let bytes = document.save(&PdfSaveOptions::default(), &mut warnings);
    if bytes.len() > provider::MAX_PDF || !bytes.starts_with(b"%PDF-") {
        return Err("signature_bundle_too_large");
    }
    Ok(bytes)
}

pub(super) async fn persist_signing_members(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    request_id: Uuid,
    members: &[PreparedSigningMember],
) -> Result<(), Response> {
    for (index, prepared) in members.iter().enumerate() {
        let id: Uuid = prepared.row.get("id");
        let current = sqlx::query("SELECT *, NOT EXISTS(SELECT 1 FROM documents v WHERE v.replaces_document_id=d.id) AS is_latest_version FROM documents d WHERE id=$1 FOR UPDATE")
            .bind(id).fetch_one(&mut **tx).await.map_err(db_error)?;
        if eligibility(&current).is_some() || context(&current) != context(&prepared.row) {
            return Err(error(StatusCode::CONFLICT, "signing_document_changed"));
        }
        sqlx::query("INSERT INTO document_signature_members(request_id,document_id,position,sha256,source_context) VALUES ($1,$2,$3,$4,$5)")
            .bind(request_id).bind(id).bind(index as i16 + 1).bind(&prepared.hash).bind(context(&prepared.row))
            .execute(&mut **tx).await.map_err(db_error)?;
    }
    Ok(())
}

pub(super) async fn signing_sources_current(
    state: &AppState,
    request: &PgRow,
    source: &PgRow,
) -> Result<bool, &'static str> {
    if eligibility(source).is_some() || context(source) != request.get::<Value, _>("source_context")
    {
        return Ok(false);
    }
    let primary = source_bytes(source).await?;
    let primary_hash = request
        .get::<Option<String>, _>("primary_source_sha256")
        .unwrap_or_else(|| request.get::<String, _>("source_sha256"));
    if sha256(&primary) != primary_hash {
        return Ok(false);
    }
    let members = sqlx::query(
        "SELECT * FROM document_signature_members WHERE request_id=$1 ORDER BY position",
    )
    .bind(request.get::<Uuid, _>("id"))
    .fetch_all(&state.db)
    .await
    .map_err(|_| "signature_database_error")?;
    for member in members {
        let current = sqlx::query("SELECT *, NOT EXISTS(SELECT 1 FROM documents v WHERE v.replaces_document_id=d.id) AS is_latest_version FROM documents d WHERE id=$1")
            .bind(member.get::<Uuid,_>("document_id"))
            .fetch_one(&state.db)
            .await
            .map_err(|_| "signature_database_error")?;
        if eligibility(&current).is_some()
            || context(&current) != member.get::<Value, _>("source_context")
        {
            return Ok(false);
        }
        let bytes = source_bytes(&current).await?;
        if sha256(&bytes) != member.get::<String, _>("sha256") {
            return Ok(false);
        }
    }
    Ok(true)
}

pub(super) async fn signing_sources_current_in_transaction(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    request: &PgRow,
    source: &PgRow,
) -> Result<bool, &'static str> {
    if eligibility(source).is_some() || context(source) != request.get::<Value, _>("source_context")
    {
        return Ok(false);
    }
    let primary = source_bytes(source).await?;
    let primary_hash = request
        .get::<Option<String>, _>("primary_source_sha256")
        .unwrap_or_else(|| request.get::<String, _>("source_sha256"));
    if sha256(&primary) != primary_hash {
        return Ok(false);
    }
    let members = sqlx::query(
        "SELECT * FROM document_signature_members WHERE request_id=$1 ORDER BY position FOR UPDATE",
    )
    .bind(request.get::<Uuid, _>("id"))
    .fetch_all(&mut **tx)
    .await
    .map_err(|_| "signature_database_error")?;
    for member in members {
        let current = sqlx::query("SELECT *, NOT EXISTS(SELECT 1 FROM documents v WHERE v.replaces_document_id=d.id) AS is_latest_version FROM documents d WHERE id=$1 FOR UPDATE")
            .bind(member.get::<Uuid,_>("document_id"))
            .fetch_one(&mut **tx)
            .await
            .map_err(|_| "signature_database_error")?;
        if eligibility(&current).is_some()
            || context(&current) != member.get::<Value, _>("source_context")
        {
            return Ok(false);
        }
        let bytes = source_bytes(&current).await?;
        if sha256(&bytes) != member.get::<String, _>("sha256") {
            return Ok(false);
        }
    }
    Ok(true)
}

pub(super) async fn signing_member_ids(
    state: &AppState,
    request_id: Uuid,
) -> Result<Vec<Uuid>, &'static str> {
    sqlx::query_scalar(
        "SELECT document_id FROM document_signature_members WHERE request_id=$1 ORDER BY position",
    )
    .bind(request_id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| "signature_database_error")
}

pub(super) async fn prepare(
    state: &AppState,
    auth: &AuthUser,
    source: &PgRow,
    selected: Option<Uuid>,
) -> Result<Option<Prepared>, Response> {
    let required = companion(
        source
            .get::<Option<String>, _>("generated_template_id")
            .as_deref(),
    );
    let Some(template) = required else {
        if selected.is_some() {
            return Err(error(
                StatusCode::UNPROCESSABLE_ENTITY,
                "unexpected_review_attachment",
            ));
        }
        return Ok(None);
    };
    let id = selected.ok_or_else(|| {
        error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "review_attachment_required",
        )
    })?;
    let row = signature_document_access(state, auth, id, false).await?;
    if row
        .get::<Option<String>, _>("generated_template_id")
        .as_deref()
        != Some(template)
        || !same_scope(source, &row)
        || eligibility(&row).is_some()
    {
        return Err(error(StatusCode::CONFLICT, "review_attachment_changed"));
    }
    let bytes = source_bytes(&row)
        .await
        .map_err(|e| error(StatusCode::UNPROCESSABLE_ENTITY, e))?;
    scan_upload_bytes(Some("attachment.pdf"), &bytes)
        .await
        .map_err(|_| error(StatusCode::UNPROCESSABLE_ENTITY, "signature_scan_failed"))?;
    let version: i32 = row.get("version_number");
    let title = if template == "privacy_information" {
        "Datenschutzinformation"
    } else {
        "Vorlaeufige-medizinische-Kostenkalkulation"
    };
    Ok(Some(Prepared {
        hash: sha256(&bytes),
        filename: format!("{title}-v{version}-{id}.pdf"),
        row,
    }))
}

pub(super) async fn persist(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    request_id: Uuid,
    prepared: &Prepared,
) -> Result<(), Response> {
    let id: Uuid = prepared.row.get("id");
    let current = sqlx::query("SELECT *, NOT EXISTS(SELECT 1 FROM documents v WHERE v.replaces_document_id=d.id) AS is_latest_version FROM documents d WHERE id=$1 FOR UPDATE")
        .bind(id).fetch_one(&mut **tx).await.map_err(db_error)?;
    if eligibility(&current).is_some() || context(&current) != context(&prepared.row) {
        return Err(error(StatusCode::CONFLICT, "review_attachment_changed"));
    }
    sqlx::query("INSERT INTO document_signature_attachments(request_id,document_id,filename,sha256,source_context) VALUES ($1,$2,$3,$4,$5)")
        .bind(request_id).bind(id).bind(&prepared.filename).bind(&prepared.hash).bind(context(&prepared.row))
        .execute(&mut **tx).await.map_err(db_error)?;
    Ok(())
}

pub(super) async fn row(state: &AppState, id: Uuid) -> Result<Option<PgRow>, &'static str> {
    sqlx::query("SELECT * FROM document_signature_attachments WHERE request_id=$1")
        .bind(id)
        .fetch_optional(&state.db)
        .await
        .map_err(|_| "signature_database_error")
}

fn attachment_id(value: &Value, filename: &str) -> Result<Option<Uuid>, &'static str> {
    let values = value["attachments"].as_array();
    if values.is_none_or(|v| v.is_empty()) {
        return Ok(None);
    }
    let values = values.unwrap();
    if values.len() != 1 || values[0]["filename"] != filename {
        return Err("review_attachment_mismatch");
    }
    values[0]["attachment_id"]
        .as_str()
        .and_then(|v| Uuid::parse_str(v).ok())
        .map(Some)
        .ok_or("review_attachment_mismatch")
}

// Called only under the existing worker lease. Returns the fully invited state,
// or a terminal empty-signers state that may safely be withdrawn.
pub(super) async fn sync(
    state: &AppState,
    request: &PgRow,
    provider: &provider::Provider,
    mut value: Value,
    signers: &[Signer],
) -> Result<Value, &'static str> {
    let id: Uuid = request.get("id");
    let Some(attachment) = row(state, id).await? else {
        return Ok(value);
    };
    let hash: String = request.get("source_sha256");
    let empty = value["signatures"].as_array().is_some_and(|s| s.is_empty());
    let verified = provider.validate(
        &value,
        id,
        &hash,
        request.get("provider_request_id"),
        if empty { &[] } else { signers },
    )?;
    let remote = verified.id;
    sqlx::query("UPDATE document_signature_requests SET provider_request_id=$2 WHERE id=$1")
        .bind(id)
        .bind(remote)
        .execute(&state.db)
        .await
        .map_err(|_| "signature_database_error")?;
    if matches!(
        verified.status.as_str(),
        "WITHDRAWN" | "DECLINED" | "EXPIRED" | "ERROR"
    ) && empty
    {
        return Ok(value);
    }
    let filename: String = attachment.get("filename");
    let expected_hash: String = attachment.get("sha256");
    let mut stage: String = attachment.get("stage");
    let mut attached = attachment_id(&value, &filename)?;
    if stage == "sent" {
        if attached != attachment.get::<Option<Uuid>, _>("provider_attachment_id")
            || attached.is_none()
        {
            return Err("review_attachment_mismatch");
        }
        return Ok(value);
    }
    if attached.is_none() {
        if stage != "prepared" || !empty {
            return Err("review_package_submission_unknown");
        }
        let source = sqlx::query("SELECT *, NOT EXISTS(SELECT 1 FROM documents v WHERE v.replaces_document_id=d.id) AS is_latest_version FROM documents d WHERE id=$1")
            .bind(attachment.get::<Uuid,_>("document_id")).fetch_one(&state.db).await.map_err(|_| "signature_database_error")?;
        if eligibility(&source).is_some()
            || context(&source) != attachment.get::<Value, _>("source_context")
        {
            return Err("review_attachment_changed");
        }
        let bytes = source_bytes(&source).await?;
        if sha256(&bytes) != expected_hash {
            return Err("review_attachment_changed");
        }
        set_stage(state, id, "attaching", None).await?;
        value = provider.add_attachment(remote, &filename, &bytes).await?;
        // Attachment endpoints may return a partial request; use an authoritative GET.
        let _ = value;
        value = provider.get(remote).await?;
        provider.validate(&value, id, &hash, Some(remote), &[])?;
        attached = attachment_id(&value, &filename)?;
        stage = "attaching".into();
    }
    let attachment_id = attached.ok_or("review_attachment_mismatch")?;
    let bytes = provider.attachment_content(remote, attachment_id).await?;
    if sha256(&bytes) != expected_hash {
        return Err("review_attachment_mismatch");
    }
    if stage == "prepared" || stage == "attaching" {
        set_stage(state, id, "attached", Some(attachment_id)).await?;
        stage = "attached".into();
    }
    if empty {
        if stage != "attached" {
            return Err("review_package_submission_unknown");
        }
        // A manager may have replaced either PDF while preparation was running.
        // Do not invite recipients to an obsolete or reassigned package.
        let primary = sqlx::query("SELECT *, NOT EXISTS(SELECT 1 FROM documents v WHERE v.replaces_document_id=d.id) AS is_latest_version FROM documents d WHERE id=$1")
            .bind(request.get::<Uuid, _>("source_document_id"))
            .fetch_one(&state.db)
            .await
            .map_err(|_| "signature_database_error")?;
        if !signing_sources_current(state, request, &primary).await? {
            return Err("signing_document_changed");
        }
        let current_attachment = sqlx::query("SELECT *, NOT EXISTS(SELECT 1 FROM documents v WHERE v.replaces_document_id=d.id) AS is_latest_version FROM documents d WHERE id=$1")
            .bind(attachment.get::<Uuid, _>("document_id"))
            .fetch_one(&state.db)
            .await
            .map_err(|_| "signature_database_error")?;
        if eligibility(&current_attachment).is_some()
            || context(&current_attachment) != attachment.get::<Value, _>("source_context")
            || sha256(&source_bytes(&current_attachment).await?) != expected_hash
        {
            return Err("review_attachment_changed");
        }
        set_stage(state, id, "inviting", Some(attachment_id)).await?;
        // A timeout here cannot be retried; subsequent GET must prove whether the
        // recipients were added. Until then no Sent/Acknowledged status is inferred.
        value = provider.invite(remote, signers).await?;
    }
    provider.validate(&value, id, &hash, Some(remote), signers)?;
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| "signature_database_error")?;
    // Serialize manual acknowledgement with a new delivery of this same version.
    sqlx::query("SELECT id FROM documents WHERE id=$1 FOR UPDATE")
        .bind(attachment.get::<Uuid, _>("document_id"))
        .execute(&mut *tx)
        .await
        .map_err(|_| "signature_database_error")?;
    sqlx::query("UPDATE document_signature_attachments SET stage='sent',provider_attachment_id=$2 WHERE request_id=$1")
        .bind(id).bind(attachment_id).execute(&mut *tx).await.map_err(|_| "signature_database_error")?;
    sqlx::query("INSERT INTO document_review_events(id,document_id,kind,actor_id,signature_request_id,test_mode) VALUES ($1,$2,'sent',$3,$4,$5) ON CONFLICT DO NOTHING")
        .bind(Uuid::new_v4()).bind(attachment.get::<Uuid,_>("document_id")).bind(request.get::<Uuid,_>("requested_by"))
        .bind(id).bind(request.get::<bool,_>("test_mode")).execute(&mut *tx).await.map_err(|_| "signature_database_error")?;
    tx.commit().await.map_err(|_| "signature_database_error")?;
    Ok(value)
}

async fn set_stage(
    state: &AppState,
    id: Uuid,
    stage: &str,
    remote: Option<Uuid>,
) -> Result<(), &'static str> {
    sqlx::query("UPDATE document_signature_attachments SET stage=$2,provider_attachment_id=COALESCE($3,provider_attachment_id) WHERE request_id=$1")
        .bind(id).bind(stage).bind(remote).execute(&state.db).await.map_err(|_| "signature_database_error")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use printpdf::{Mm, PdfPage};
    #[test]
    fn explicit_companion_mapping_and_exact_attachment_identity() {
        assert_eq!(
            companion(Some("framework_contract")),
            Some("privacy_information")
        );
        assert_eq!(
            companion(Some("confidentiality_release")),
            Some("privacy_information")
        );
        assert_eq!(
            companion(Some("order_cost_estimate")),
            Some("cost_estimate")
        );
        assert_eq!(companion(Some("single_order")), None);
        assert_eq!(companion(None), None);
        assert_eq!(
            signing_companions(Some("confidentiality_release"), false),
            ["privacy_consents"]
        );
        assert!(signing_companions(Some("privacy_consents"), true).is_empty());
        // Lead intake sends the whole onboarding package from the contract; an
        // existing patient's contract or order is still signed on its own.
        assert_eq!(
            signing_companions(Some("framework_contract"), true),
            [
                "single_order",
                "confidentiality_release",
                "privacy_consents"
            ]
        );
        assert!(signing_companions(Some("framework_contract"), false).is_empty());
        assert!(signing_companions(Some("single_order"), true).is_empty());
        let id = Uuid::new_v4();
        assert_eq!(
            attachment_id(
                &json!({"attachments":[{"filename":"a.pdf","attachment_id":id}]}),
                "a.pdf"
            )
            .unwrap(),
            Some(id)
        );
        assert!(
            attachment_id(
                &json!({"attachments":[{"filename":"b.pdf","attachment_id":id}]}),
                "a.pdf"
            )
            .is_err()
        );
        assert!(attachment_id(&json!({"attachments":[{"filename":"a.pdf","attachment_id":id},{"filename":"extra.pdf","attachment_id":id}]}), "a.pdf").is_err());
        assert_eq!(
            attachment_id(&json!({"attachments":[]}), "a.pdf").unwrap(),
            None
        );
    }

    #[test]
    fn signing_bundle_keeps_all_pages_in_one_pdf() {
        fn pdf(page_count: usize) -> Vec<u8> {
            let mut document = PdfDocument::new("test");
            document.with_pages(
                (0..page_count)
                    .map(|_| PdfPage::new(Mm(210.0), Mm(297.0), vec![]))
                    .collect(),
            );
            document.save(&PdfSaveOptions::default(), &mut Vec::new())
        }

        let (order, release, consents) = (pdf(3), pdf(1), pdf(2));
        let merged = merge_signing_pdfs(
            &pdf(2),
            &[order.as_slice(), release.as_slice(), consents.as_slice()],
        )
        .unwrap();
        let parsed =
            PdfDocument::parse(&merged, &PdfParseOptions::default(), &mut Vec::new()).unwrap();
        assert_eq!(parsed.pages.len(), 8);
        let alone = pdf(2);
        assert_eq!(merge_signing_pdfs(&alone, &[]).unwrap(), alone);
    }
}
