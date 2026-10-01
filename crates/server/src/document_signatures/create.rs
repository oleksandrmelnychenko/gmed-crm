//! Composing and sending a signature request: one document or a package of
//! documents of one patient or one lead, merged into one PDF that is signed
//! once. Every document is checked like a single request (edit rights, current
//! version, PDF, not already signed or out for signature, electronic form
//! allowed); the package takes the strictest signer policy and the highest
//! minimum signature level of its documents.
use super::*;
use axum::extract::Query;
use provider::{InvitationOptions, MAX_SIGNING_BUNDLE};

/// At most this many documents are signed in one package.
pub(super) const MAX_PACKAGE_DOCUMENTS: usize = 10;
/// How far ahead an invitation may expire.
const MAX_EXPIRY_DAYS: i64 = 180;

pub(super) struct Plan {
    pub(super) document_ids: Vec<Uuid>,
    pub(super) signers: Vec<Signer>,
    pub(super) attachment_ids: Vec<Uuid>,
    pub(super) level: Option<Level>,
    pub(super) expires_at: Option<DateTime<Utc>>,
    pub(super) note: Option<String>,
    pub(super) language: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct CreatePackageRequest {
    document_ids: Vec<Uuid>,
    signers: Vec<Signer>,
    #[serde(default)]
    attachment_ids: Vec<Uuid>,
    level: Option<Level>,
    expires_at: Option<DateTime<Utc>>,
    message: Option<String>,
    language: Option<String>,
}

/// `POST /signature-packages`
pub(super) async fn create_package(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<CreatePackageRequest>,
) -> Result<(StatusCode, Json<Value>), Response> {
    let id = create_request(
        &state,
        &auth,
        Plan {
            document_ids: body.document_ids,
            signers: body.signers,
            attachment_ids: body.attachment_ids,
            level: body.level,
            expires_at: body.expires_at,
            note: body.message,
            language: body.language,
        },
    )
    .await?;
    Ok((StatusCode::ACCEPTED, Json(json!({"id":id}))))
}

/// Patient or lead of a package. A package never mixes subjects; documents
/// without a subject can only be signed alone.
fn package_scope(rows: &[PgRow]) -> Result<(), Response> {
    if rows.len() < 2 {
        return Ok(());
    }
    let first = &rows[0];
    let patient: Option<Uuid> = first.get("patient_id");
    let lead: Option<Uuid> = first.get("lead_id");
    let matches = |row: &PgRow| match (patient, lead) {
        (Some(patient), _) => row.get::<Option<Uuid>, _>("patient_id") == Some(patient),
        (None, Some(lead)) => {
            row.get::<Option<Uuid>, _>("patient_id").is_none()
                && row.get::<Option<Uuid>, _>("lead_id") == Some(lead)
        }
        (None, None) => false,
    };
    if patient.is_none() && lead.is_none() {
        return Err(error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "signature_package_scope_required",
        ));
    }
    if let Some(row) = rows.iter().skip(1).find(|row| !matches(row)) {
        return Err(document_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "signature_package_scope_mismatch",
            row.get("id"),
        ));
    }
    Ok(())
}

struct Member {
    row: PgRow,
    bytes: Vec<u8>,
    hash: String,
    pages: Option<usize>,
}

fn normalized_language(language: Option<&str>) -> Result<Option<String>, Response> {
    match language.map(str::trim).filter(|value| !value.is_empty()) {
        None => Ok(None),
        Some(value) if provider::LANGUAGES.contains(&value) => Ok(Some(value.to_string())),
        Some(_) => Err(error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "signature_language_invalid",
        )),
    }
}

/// Languages recorded for the patient or lead of the document.
async fn scope_languages(state: &AppState, row: &PgRow) -> Result<Vec<String>, Response> {
    match (
        row.get::<Option<Uuid>, _>("patient_id"),
        row.get::<Option<Uuid>, _>("lead_id"),
    ) {
        (Some(patient), _) => sqlx::query_scalar::<_, Option<Vec<String>>>(
            "SELECT languages FROM patients WHERE id=$1",
        )
        .bind(patient)
        .fetch_optional(&state.db)
        .await
        .map_err(db_error)
        .map(|languages| languages.flatten().unwrap_or_default()),
        (None, Some(lead)) => sqlx::query_scalar::<_, Option<String>>(
            "SELECT primary_language FROM leads WHERE id=$1",
        )
        .bind(lead)
        .fetch_optional(&state.db)
        .await
        .map_err(db_error)
        .map(|language| language.flatten().into_iter().collect()),
        _ => Ok(vec![]),
    }
}

pub(super) async fn create_request(
    state: &AppState,
    auth: &AuthUser,
    plan: Plan,
) -> Result<Uuid, Response> {
    let provider = connection::current_provider(state)
        .await
        .map_err(|e| error(StatusCode::SERVICE_UNAVAILABLE, e))?
        .ok_or_else(|| error(StatusCode::SERVICE_UNAVAILABLE, "signature_not_configured"))?;
    if plan.document_ids.is_empty() || plan.document_ids.len() > MAX_PACKAGE_DOCUMENTS {
        return Err(error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "signature_package_size",
        ));
    }
    let mut unique = plan.document_ids.clone();
    unique.sort();
    unique.dedup();
    if unique.len() != plan.document_ids.len() {
        return Err(error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "duplicate_signing_document",
        ));
    }

    // Edit rights on every document: sending exports it and changes its state.
    let mut rows = Vec::with_capacity(plan.document_ids.len());
    for id in &plan.document_ids {
        rows.push(signature_document_access(state, auth, *id, true).await?);
    }
    for row in &rows {
        let id: Uuid = row.get("id");
        if let Some(reason) = eligibility(row) {
            return Err(document_error(StatusCode::CONFLICT, reason, id));
        }
        if let Some(statute) = electronic_form_excluded(row) {
            return Err((
                StatusCode::UNPROCESSABLE_ENTITY,
                Json(
                    json!({"error":"electronic_form_excluded","statute":statute,"document_id":id}),
                ),
            )
                .into_response());
        }
        if legal::informational(template_of(row).as_deref()) {
            return Err(document_error(
                StatusCode::UNPROCESSABLE_ENTITY,
                "informational_document_not_signable",
                id,
            ));
        }
    }
    package_scope(&rows)?;

    let mut signers = provider::normalize_signers(plan.signers)
        .map_err(|e| error(StatusCode::UNPROCESSABLE_ENTITY, e))?;
    let policy = SignerPolicy::combine(rows.iter().map(signer_policy))
        .map_err(|code| error(StatusCode::UNPROCESSABLE_ENTITY, code))?;
    policy
        .validate(&signers)
        .map_err(|code| error(StatusCode::UNPROCESSABLE_ENTITY, code))?;

    // § 126a BGB: the level never falls below the strictest document.
    let minimum = rows.iter().map(minimum_level).max().unwrap_or_default();
    let level = plan.level.unwrap_or(Level::Qes);
    if level < minimum {
        return Err((
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(json!({"error":"signature_level_too_low","minimum_level":minimum.as_str()})),
        )
            .into_response());
    }
    if let Some(expires_at) = plan.expires_at
        && (expires_at < Utc::now() + chrono::Duration::hours(1)
            || expires_at > Utc::now() + chrono::Duration::days(MAX_EXPIRY_DAYS))
    {
        return Err(error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "signature_expiry_invalid",
        ));
    }
    let note = legal::normalize_note(plan.note.as_deref())
        .map_err(|code| error(StatusCode::UNPROCESSABLE_ENTITY, code))?;
    let language = match normalized_language(plan.language.as_deref())? {
        Some(language) => language,
        None => legal::suggested_language(&scope_languages(state, &rows[0]).await?).to_string(),
    };

    let mut members = Vec::with_capacity(rows.len());
    for row in rows {
        let id: Uuid = row.get("id");
        let bytes = source_bytes(&row)
            .await
            .map_err(|e| document_error(StatusCode::UNPROCESSABLE_ENTITY, e, id))?;
        let facts = package::inspect_pdf(&bytes);
        // A PDF that already carries a signature would lose it in the bundle
        // and confuse the provider's validation; it is sent on its own merits.
        if facts.signed {
            return Err(document_error(
                StatusCode::UNPROCESSABLE_ENTITY,
                "signature_pdf_already_signed",
                id,
            ));
        }
        members.push(Member {
            hash: sha256(&bytes),
            pages: facts.pages,
            row,
            bytes,
        });
    }
    if members.len() > 1 && members.iter().any(|member| member.pages.is_none()) {
        let id = members
            .iter()
            .find(|member| member.pages.is_none())
            .map(|member| member.row.get::<Uuid, _>("id"))
            .unwrap_or_default();
        return Err(document_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "signature_bundle_invalid_pdf",
            id,
        ));
    }
    let bytes = package::merge_signing_pdfs(
        &members[0].bytes,
        &members[1..]
            .iter()
            .map(|member| member.bytes.as_slice())
            .collect::<Vec<_>>(),
    )
    .map_err(|e| error(StatusCode::UNPROCESSABLE_ENTITY, e))?;
    if bytes.len() > MAX_SIGNING_BUNDLE {
        return Err((
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(json!({"error":"signature_bundle_too_large","bytes":bytes.len(),"max_bytes":MAX_SIGNING_BUNDLE})),
        )
            .into_response());
    }
    package::assign_visual_positions(
        &members
            .iter()
            .map(|member| (&member.row, member.bytes.as_slice(), member.pages))
            .collect::<Vec<_>>(),
        &mut signers,
    )
    .await;
    let member_rows: Vec<&PgRow> = members.iter().map(|member| &member.row).collect();
    let attachments =
        package::prepare_attachments(state, auth, &member_rows, &plan.attachment_ids).await?;
    scan_upload_bytes(Some("source.pdf"), &bytes)
        .await
        .map_err(|_| error(StatusCode::UNPROCESSABLE_ENTITY, "signature_scan_failed"))?;

    let request_id = Uuid::new_v4();
    let source_id: Uuid = members[0].row.get("id");
    let source_hash = sha256(&bytes);
    let is_package = members.len() > 1;
    // Transparency: every signer sees the complete set, in order, with pages.
    let mut page = 1;
    let index: Vec<legal::IndexEntry> = members
        .iter()
        .map(|member| {
            let count = member.pages.unwrap_or(1);
            let entry = legal::IndexEntry {
                label: legal::invitation_label(
                    template_of(&member.row).as_deref(),
                    &member.row.get::<String, _>("art"),
                    member.row.get::<bool, _>("is_medical"),
                ),
                page_start: page,
                page_count: count,
            };
            page += count;
            entry
        })
        .collect();
    let attachment_labels: Vec<&'static str> = attachments
        .iter()
        .map(|attachment| {
            legal::invitation_label(
                template_of(&attachment.row).as_deref(),
                &attachment.row.get::<String, _>("art"),
                false,
            )
        })
        .collect();
    let message = legal::invitation_message(&index, &attachment_labels, note.as_deref(), &language);
    let title = legal::invitation_title(request_id);

    // Hold the documents while committing the outbox; confirm none changed
    // during reading/scanning and none went out for signature meanwhile.
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
    for (index, member) in members.iter().enumerate() {
        let id: Uuid = member.row.get("id");
        let current = sqlx::query("SELECT *, NOT EXISTS(SELECT 1 FROM documents v WHERE v.replaces_document_id=d.id) AS is_latest_version FROM documents d WHERE id=$1 FOR UPDATE")
            .bind(id).fetch_one(&mut *tx).await.map_err(db_error)?;
        if eligibility(&current).is_some() || context(&current) != context(&member.row) {
            return Err(document_error(
                StatusCode::CONFLICT,
                if index == 0 {
                    "document_changed"
                } else {
                    "signing_document_changed"
                },
                id,
            ));
        }
    }
    let document_ids: Vec<Uuid> = members
        .iter()
        .map(|member| member.row.get::<Uuid, _>("id"))
        .collect();
    let pending: Vec<Uuid> = sqlx::query_scalar(
        "SELECT d.id FROM unnest($1::uuid[]) AS d(id)
         WHERE EXISTS(
           SELECT 1 FROM document_signature_requests r
           WHERE r.status IN ('submitting','submission_unknown','pending')
             AND (r.source_document_id = d.id OR EXISTS(
               SELECT 1 FROM document_signature_members m
               WHERE m.request_id=r.id AND m.document_id = d.id)))",
    )
    .bind(&document_ids)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_error)?;
    if !pending.is_empty() {
        return Err((
            StatusCode::CONFLICT,
            Json(json!({"error":"signature_already_pending","document_ids":pending})),
        )
            .into_response());
    }
    let inserted = sqlx::query("INSERT INTO document_signature_requests (id,source_document_id,requested_by,source_sha256,primary_source_sha256,source_context,signers,provider_account,test_mode,status,lease_until,level,minimum_level,expires_at,invitation_note,language,is_package,source_page_count) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'submitting',now()+interval '5 minutes',$10,$11,$12,$13,$14,$15,$16) ON CONFLICT DO NOTHING RETURNING id")
        .bind(request_id).bind(source_id).bind(auth.user_id).bind(&source_hash).bind(&members[0].hash)
        .bind(context(&members[0].row)).bind(json!(signers)).bind(&provider.account).bind(provider.test_mode)
        .bind(level.as_str()).bind(minimum.as_str()).bind(plan.expires_at).bind(&note).bind(&language)
        .bind(is_package).bind(members[0].pages.map(|pages| pages as i32))
        .fetch_optional(&mut *tx).await.map_err(db_error)?;
    if inserted.is_none() {
        return Err(error(StatusCode::CONFLICT, "signature_already_pending"));
    }
    let mut page_start = members[0].pages.unwrap_or(1) + 1;
    for (index, member) in members.iter().enumerate().skip(1) {
        let pages = member.pages.unwrap_or(1);
        sqlx::query("INSERT INTO document_signature_members(request_id,document_id,position,sha256,source_context,page_start,page_count) VALUES ($1,$2,$3,$4,$5,$6,$7)")
            .bind(request_id).bind(member.row.get::<Uuid,_>("id")).bind(index as i16).bind(&member.hash)
            .bind(context(&member.row)).bind(page_start as i32).bind(pages as i32)
            .execute(&mut *tx).await.map_err(db_error)?;
        page_start += pages;
    }
    for (index, attachment) in attachments.iter().enumerate() {
        package::persist(&mut tx, request_id, attachment, index as i16 + 1).await?;
    }
    // Requesting a signature sends the documents to the provider: one audit
    // row per document, committed together with the request.
    for (position, id) in document_ids
        .iter()
        .map(|id| ("signing", *id))
        .chain(
            attachments
                .iter()
                .map(|attachment| ("attachment", attachment.row.get::<Uuid, _>("id"))),
        )
        .enumerate()
    {
        audit::write_in_transaction(
            &mut tx,
            &audit::domain_event(
                "document_signature_requested",
                Some(auth.user_id),
                "document",
                Some(id.1),
                json!({"request_id":request_id,"role":id.0,"position":position,
                    "document_ids":document_ids,"level":level.as_str(),"minimum_level":minimum.as_str(),
                    "test_mode":provider.test_mode,"region":"DE"}),
            ),
        )
        .await
        .map_err(db_error)?;
    }
    tx.commit().await.map_err(db_error)?;

    let options = InvitationOptions {
        level,
        expires_at: plan.expires_at,
        message: Some(message),
        language: Some(language),
    };
    let has_attachments = !attachments.is_empty();
    let state = state.clone();
    // Persist first and respond immediately; a browser disconnect cannot trigger a second invitation.
    tokio::spawn(async move {
        let initial_signers = if has_attachments {
            &[][..]
        } else {
            &signers[..]
        };
        let result = provider
            .create_with(
                request_id,
                &title,
                &source_hash,
                &bytes,
                initial_signers,
                &options,
            )
            .await
            .and_then(|v| {
                provider.validate_level(&v, request_id, &source_hash, None, initial_signers, level)
            });
        let (remote, status, reason) = match result {
            Ok(v) => (
                Some(v.id),
                if has_attachments {
                    "submission_unknown"
                } else {
                    "pending"
                },
                None,
            ),
            Err(
                reason @ ("provider_request_rejected"
                | "provider_login_failed"
                | "provider_rate_limited"),
            ) => (None, "error", Some(reason)),
            Err(reason) => (None, "submission_unknown", Some(reason)),
        };
        if let Err(e) = sqlx::query("UPDATE document_signature_requests SET provider_request_id=$2,status=$3,last_error=$4,lease_until=NULL,next_poll_at=now(),updated_at=now() WHERE id=$1 AND status='submitting'")
            .bind(request_id).bind(remote).bind(status).bind(reason).execute(&state.db).await {
            tracing::error!(error=%e,request_id=%request_id,"Could not persist signature submission outcome");
        }
    });
    Ok(request_id)
}

#[derive(Deserialize)]
pub(super) struct CandidateQuery {
    document_id: Option<Uuid>,
    patient_id: Option<Uuid>,
    lead_id: Option<Uuid>,
}

/// `GET /signature-packages/candidates?document_id=|patient_id=|lead_id=` —
/// the PDFs of one patient or lead that the caller may send, with what the
/// composer needs to warn early: signer policy, minimum level, signature
/// frames, size and whether a document is already out for signature.
pub(super) async fn candidates(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<CandidateQuery>,
) -> Result<Json<Value>, Response> {
    auth.require_any_role(&[
        gmed_domain::role::Role::Ceo,
        gmed_domain::role::Role::PatientManager,
    ])?;
    let source = match query.document_id {
        Some(id) => Some(signature_document_access(&state, &auth, id, false).await?),
        None => None,
    };
    let (patient_id, lead_id) = match &source {
        Some(row) => (
            row.get::<Option<Uuid>, _>("patient_id"),
            row.get::<Option<Uuid>, _>("lead_id"),
        ),
        None => (query.patient_id, query.lead_id),
    };
    // A patient's package draws on the patient's documents; a lead's on the
    // lead's documents that do not belong to a patient yet.
    let ids: Vec<Uuid> = if patient_id.is_some() || lead_id.is_some() {
        sqlx::query_scalar(
            "SELECT d.id FROM documents d
             WHERE d.file_deleted_at IS NULL AND d.status <> 'archived'
               AND d.signed_at IS NULL AND d.storage_key IS NOT NULL
               AND d.mime_type = 'application/pdf'
               AND COALESCE(d.ursprung, '') NOT IN ('electronic_signature', 'electronic_signature_package')
               AND NOT EXISTS(SELECT 1 FROM documents v WHERE v.replaces_document_id = d.id)
               AND (($1::uuid IS NOT NULL AND d.patient_id = $1)
                    OR ($1::uuid IS NULL AND d.lead_id = $2 AND d.patient_id IS NULL))
             ORDER BY d.created_at DESC, d.id DESC LIMIT 100",
        )
        .bind(patient_id)
        .bind(lead_id)
        .fetch_all(&state.db)
        .await
        .map_err(db_error)?
    } else {
        query.document_id.into_iter().collect()
    };
    let pending: Vec<Uuid> = sqlx::query_scalar(
        "SELECT d.id FROM unnest($1::uuid[]) AS d(id)
         WHERE EXISTS(
           SELECT 1 FROM document_signature_requests r
           WHERE r.status IN ('submitting','submission_unknown','pending')
             AND (r.source_document_id = d.id OR EXISTS(
               SELECT 1 FROM document_signature_members m
               WHERE m.request_id=r.id AND m.document_id = d.id)))",
    )
    .bind(&ids)
    .fetch_all(&state.db)
    .await
    .map_err(db_error)?;
    let mut documents = Vec::new();
    let mut attachments = Vec::new();
    let mut first_row = source;
    for id in ids {
        let Ok(row) = signature_document_access(&state, &auth, id, true).await else {
            continue;
        };
        let template = template_of(&row);
        let base = json!({
            "id": id,
            "title": row.get::<String, _>("auto_name"),
            "template": template,
            "art": row.get::<String, _>("art"),
            "version": row.get::<i32, _>("version_number"),
            "order_id": row.get::<Option<Uuid>, _>("order_id"),
            "size": row.get::<Option<i64>, _>("file_size"),
        });
        if legal::informational(template.as_deref()) {
            if eligibility(&row).is_none() {
                attachments.push(base);
            }
            continue;
        }
        let mut candidate = base;
        let frames = package::frame_roles(&row).await;
        candidate["signer_policy"] = json!(signer_policy(&row).as_str());
        candidate["minimum_level"] = json!(minimum_level(&row).as_str());
        candidate["frame_roles"] = json!(frames);
        candidate["has_frames"] = json!(!frames.is_empty());
        candidate["companion"] = json!(legal::companion(template.as_deref()));
        candidate["is_medical"] = json!(row.get::<bool, _>("is_medical"));
        candidate["pending_elsewhere"] = json!(pending.contains(&id));
        candidate["electronic_form_excluded"] = json!(electronic_form_excluded(&row));
        candidate["ineligible_reason"] = json!(
            eligibility(&row)
                .or_else(|| electronic_form_excluded(&row).map(|_| "electronic_form_excluded"))
                .or_else(|| pending.contains(&id).then_some("signature_already_pending"))
        );
        if first_row.is_none() {
            first_row = Some(row);
        }
        documents.push(candidate);
    }
    let (presets, suggested_signers, language) = match &first_row {
        Some(row) => {
            let preset = match query.document_id {
                Some(_) => package::preset_document_ids(&state, &auth, row).await?,
                None => vec![],
            };
            (
                preset,
                defaults::suggested(&state, &auth, row, SignerPolicy::BothParties).await?,
                legal::suggested_language(&scope_languages(&state, row).await?),
            )
        }
        None => (vec![], vec![], "de"),
    };
    Ok(Json(json!({
        "scope": {"patient_id": patient_id, "lead_id": lead_id},
        "documents": documents,
        "attachments": attachments,
        "preset_document_ids": presets,
        "suggested_signers": suggested_signers,
        "suggested_language": language,
        "languages": provider::LANGUAGES,
        "limits": {
            "max_documents": MAX_PACKAGE_DOCUMENTS,
            "max_bundle_bytes": MAX_SIGNING_BUNDLE,
            "max_expiry_days": MAX_EXPIRY_DAYS,
            "max_message_chars": 500,
        },
    })))
}
