//! Signing packages and informational attachments. Each remote mutation has a
//! durable phase; ambiguous writes are reconciled, never blindly replayed.
use super::*;
use crate::routes::documents::{SIGNATURE_ANCHORS_BINDING_KEY, SignatureAnchor};

pub(super) fn companion(template: Option<&str>) -> Option<&'static str> {
    legal::companion(template)
}

const MINOR_CONSENTS: &[&str] = &["consent_data_release_child", "consent_data_release_single"];

/// The lead's patient form ("Patientenformular – Angaben und Erklärungen",
/// owner request 2026-10-08): signed by the patient side inside the lead's
/// package. It exists only once the lead sent the request, so its slot may
/// stay empty: a package without it is complete.
const LEAD_SELF_DISCLOSURE: &str = "lead_self_disclosure";

/// Preset slots a package may leave empty.
const OPTIONAL_SLOT_TEMPLATES: &[&str] = &[LEAD_SELF_DISCLOSURE];

/// Whether a package may go without a document for this slot.
fn optional_slot(slot: &[&str]) -> bool {
    !slot.is_empty()
        && slot
            .iter()
            .all(|template| OPTIONAL_SLOT_TEMPLATES.contains(template))
}

/// Documents suggested for signing together with the source, in bundle order
/// (adult patient or lead). Each entry lists the templates that can fill it.
///
/// During lead intake the framework contract carries the whole onboarding
/// package: the client gets one invitation for the contract, the order, the
/// lead's patient form (once the lead sent the request) and the consents,
/// signs first, and the agency is invited afterwards. These presets are
/// suggestions for the composer; any eligible documents of the same patient
/// or lead can be combined through `POST /signature-packages`.
pub(super) fn signing_companions(
    template: Option<&str>,
    lead_intake: bool,
) -> &'static [&'static str] {
    match template {
        Some("framework_contract") if lead_intake => &[
            "single_order",
            LEAD_SELF_DISCLOSURE,
            "confidentiality_release",
            "privacy_consents",
        ],
        // Without a new contract (a signed contract of the patient still
        // applies, or none is generated yet) the order carries the patient
        // form and the consents.
        Some("single_order") if lead_intake => &[
            LEAD_SELF_DISCLOSURE,
            "confidentiality_release",
            "privacy_consents",
        ],
        Some("confidentiality_release") => &["privacy_consents"],
        _ => &[],
    }
}

/// The preset slots, with the minors' variant: the legal representatives sign
/// one combined declaration (DSGVO release and Schweigepflichtsentbindung) for
/// the child instead of the two adult consents, and the child's patient form.
pub(super) fn signing_slots(
    template: Option<&str>,
    lead_intake: bool,
    minor: bool,
) -> Vec<&'static [&'static str]> {
    if !minor {
        return signing_companions(template, lead_intake)
            .iter()
            .map(std::slice::from_ref)
            .collect();
    }
    match template {
        Some("framework_contract") if lead_intake => {
            vec![
                &["single_order"][..],
                &[LEAD_SELF_DISCLOSURE][..],
                MINOR_CONSENTS,
            ]
        }
        Some("single_order") if lead_intake => {
            vec![&[LEAD_SELF_DISCLOSURE][..], MINOR_CONSENTS]
        }
        _ => vec![],
    }
}

/// A lead's documents belong to no patient until the lead is converted.
fn is_lead_intake(source: &PgRow) -> bool {
    source.get::<Option<Uuid>, _>("lead_id").is_some()
        && source.get::<Option<Uuid>, _>("patient_id").is_none()
}

/// Whether the patient or lead of this document is a minor.
pub(super) async fn scope_is_minor(state: &AppState, source: &PgRow) -> Result<bool, Response> {
    let birth_date: Option<chrono::NaiveDate> = match (
        source.get::<Option<Uuid>, _>("patient_id"),
        source.get::<Option<Uuid>, _>("lead_id"),
    ) {
        (Some(patient), _) => sqlx::query_scalar("SELECT birth_date FROM patients WHERE id=$1")
            .bind(patient)
            .fetch_optional(&state.db)
            .await
            .map_err(db_error)?
            .flatten(),
        (None, Some(lead)) => sqlx::query_scalar("SELECT date_of_birth FROM leads WHERE id=$1")
            .bind(lead)
            .fetch_optional(&state.db)
            .await
            .map_err(db_error)?
            .flatten(),
        _ => None,
    };
    Ok(defaults::is_minor(birth_date))
}

async fn source_slots(
    state: &AppState,
    source: &PgRow,
) -> Result<Vec<&'static [&'static str]>, Response> {
    let template = template_of(source);
    if signing_companions(template.as_deref(), is_lead_intake(source)).is_empty() {
        return Ok(vec![]);
    }
    let minor = scope_is_minor(state, source).await?;
    Ok(signing_slots(
        template.as_deref(),
        is_lead_intake(source),
        minor,
    ))
}

pub(super) fn same_scope(source: &PgRow, candidate: &PgRow) -> bool {
    let lead: Option<Uuid> = source.get("lead_id");
    let patient: Option<Uuid> = source.get("patient_id");
    if let Some(lead) = lead {
        candidate.get::<Option<Uuid>, _>("lead_id") == Some(lead)
            && patient
                .zip(candidate.get::<Option<Uuid>, _>("patient_id"))
                .is_none_or(|(a, b)| a == b)
    } else {
        patient.is_some() && candidate.get::<Option<Uuid>, _>("patient_id") == patient
    }
}

async fn scope_documents(
    state: &AppState,
    source: &PgRow,
    templates: &[&str],
) -> Result<Vec<Uuid>, Response> {
    sqlx::query_scalar(
        "SELECT id FROM documents WHERE generated_template_id = ANY($1) AND file_deleted_at IS NULL AND status<>'archived'
         AND (($2::uuid IS NOT NULL AND lead_id=$2) OR ($2::uuid IS NULL AND $3::uuid IS NOT NULL AND patient_id=$3))
         ORDER BY created_at DESC,id DESC LIMIT 100",
    )
    .bind(templates.iter().map(|t| t.to_string()).collect::<Vec<_>>())
    .bind(source.get::<Option<Uuid>, _>("lead_id"))
    .bind(source.get::<Option<Uuid>, _>("patient_id"))
    .fetch_all(&state.db)
    .await
    .map_err(db_error)
}

pub(super) async fn options(
    state: &AppState,
    auth: &AuthUser,
    source: &PgRow,
) -> Result<Value, Response> {
    let Some(template) = companion(template_of(source).as_deref()) else {
        return Ok(Value::Null);
    };
    let mut choices = Vec::new();
    for id in scope_documents(state, source, &[template]).await? {
        if let Ok(row) = signature_document_access(state, auth, id, false).await
            && attachment_scope_matches(template, &[source], &row)
            && eligibility(&row).is_none()
        {
            choices.push(json!({"id":id,"title":row.get::<String,_>("auto_name"),"version":row.get::<i32,_>("version_number")}));
        }
    }
    Ok(json!({"template":template,"documents":choices}))
}

/// One entry per preset slot, in bundle order; an entry without documents
/// tells the client which document still has to be created.
pub(super) async fn signing_options(
    state: &AppState,
    auth: &AuthUser,
    source: &PgRow,
) -> Result<Value, Response> {
    let mut packages = Vec::new();
    for slot in source_slots(state, source).await? {
        let mut choices = Vec::new();
        for id in scope_documents(state, source, slot).await? {
            if let Ok(row) = signature_document_access(state, auth, id, false).await
                && same_scope(source, &row)
                && eligibility(&row).is_none()
            {
                choices.push(json!({"id":id,"title":row.get::<String,_>("auto_name"),"version":row.get::<i32,_>("version_number"),"template":template_of(&row)}));
            }
        }
        packages.push(json!({"template":slot[0],"templates":slot,"documents":choices}));
    }
    Ok(Value::Array(packages))
}

/// The cost estimate (Kostenvoranschlag, Anlage 1) of the order a single order
/// document belongs to: the newest eligible one. It is signed in the same
/// package, so the client gets one invitation for the order and its estimate.
async fn order_cost_estimate_of(
    state: &AppState,
    auth: &AuthUser,
    source: &PgRow,
    order_document: &PgRow,
) -> Result<Option<Uuid>, Response> {
    let Some(order) = order_document.get::<Option<Uuid>, _>("order_id") else {
        return Ok(None);
    };
    for id in scope_documents(state, source, &["order_cost_estimate"]).await? {
        if let Ok(row) = signature_document_access(state, auth, id, true).await
            && same_scope(source, &row)
            && row.get::<Option<Uuid>, _>("order_id") == Some(order)
            && eligibility(&row).is_none()
        {
            return Ok(Some(id));
        }
    }
    Ok(None)
}

/// The suggested companions of a source as document IDs (the newest eligible
/// document per slot), used by the composer as its initial selection. A single
/// order, as the source or as a companion, is followed by its cost estimate.
pub(super) async fn preset_document_ids(
    state: &AppState,
    auth: &AuthUser,
    source: &PgRow,
) -> Result<Vec<Uuid>, Response> {
    let mut ids = Vec::new();
    if template_of(source).as_deref() == Some("single_order")
        && let Some(estimate) = order_cost_estimate_of(state, auth, source, source).await?
    {
        ids.push(estimate);
    }
    for slot in source_slots(state, source).await? {
        for id in scope_documents(state, source, slot).await? {
            if let Ok(row) = signature_document_access(state, auth, id, true).await
                && same_scope(source, &row)
                && eligibility(&row).is_none()
            {
                ids.push(id);
                if template_of(&row).as_deref() == Some("single_order")
                    && let Some(estimate) =
                        order_cost_estimate_of(state, auth, source, &row).await?
                {
                    ids.push(estimate);
                }
                break;
            }
        }
    }
    Ok(ids)
}

/// Legacy `POST /documents/{id}/signature-requests`: the selected companions
/// must fill the source's preset slots, one document per slot; an optional
/// slot (the lead's patient form) may stay empty. They are put into bundle
/// order; the generic endpoint accepts any combination.
pub(super) async fn legacy_signing_order(
    state: &AppState,
    auth: &AuthUser,
    source: &PgRow,
    selected: &[Uuid],
) -> Result<Vec<Uuid>, Response> {
    let slots = source_slots(state, source).await?;
    let mut rows = Vec::with_capacity(selected.len());
    for id in selected {
        rows.push(signature_document_access(state, auth, *id, true).await?);
    }
    if rows.iter().any(|row| {
        !template_of(row)
            .as_deref()
            .is_some_and(|template| slots.iter().any(|slot| slot.contains(&template)))
    }) || rows.len() > slots.len()
    {
        return Err(error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "unexpected_signing_document",
        ));
    }
    let mut ordered = Vec::with_capacity(slots.len());
    for slot in slots {
        let Some(position) = rows.iter().position(|row| {
            template_of(row)
                .as_deref()
                .is_some_and(|template| slot.contains(&template))
        }) else {
            if optional_slot(slot) {
                continue;
            }
            return Err(error(
                StatusCode::UNPROCESSABLE_ENTITY,
                "signing_document_required",
            ));
        };
        let row = rows.swap_remove(position);
        if !same_scope(source, &row) {
            return Err(error(StatusCode::CONFLICT, "signing_document_changed"));
        }
        ordered.push(row.get::<Uuid, _>("id"));
    }
    Ok(ordered)
}

/// Facts about a PDF needed before sending it.
pub(crate) struct PdfFacts {
    /// `None` when the file cannot be parsed; a single unparseable PDF is sent
    /// unchanged and positioned by the provider.
    pub(crate) pages: Option<usize>,
    /// The PDF already carries a digital signature.
    pub(crate) signed: bool,
}

pub(crate) fn inspect_pdf(bytes: &[u8]) -> PdfFacts {
    use lopdf::Object;
    match lopdf::Document::load_mem(bytes) {
        Ok(document) => {
            let signed = document.objects.values().any(|object| {
                object.as_dict().is_ok_and(|dict| {
                    dict.get(b"Type")
                        .and_then(Object::as_name)
                        .is_ok_and(|name| name == b"Sig" || name == b"DocTimeStamp")
                        || (dict.has(b"ByteRange") && dict.has(b"Contents"))
                })
            });
            PdfFacts {
                pages: Some(document.get_pages().len()).filter(|pages| *pages > 0),
                signed,
            }
        }
        Err(_) => PdfFacts {
            pages: None,
            signed: bytes.windows(10).any(|window| window == b"/ByteRange"),
        },
    }
}

/// Merges at the PDF object level. The pages, their content streams and the
/// embedded fonts are copied untouched: re-parsing and re-saving a generated PDF
/// through printpdf drops the text's font mapping and the recipient sees glyph
/// indices instead of letters. Form fields (AcroForm), the structure tree and
/// PDF/A identification of the members are not carried into the bundle.
pub(crate) fn merge_signing_pdfs(
    primary: &[u8],
    members: &[&[u8]],
) -> Result<Vec<u8>, &'static str> {
    use lopdf::{Dictionary, Document, Object, ObjectId};

    if members.is_empty() {
        return Ok(primary.to_vec());
    }
    let mut merged = Document::with_version("1.7");
    let mut next_id = 1;
    let mut page_ids: Vec<ObjectId> = Vec::new();
    for bytes in std::iter::once(&primary).chain(members.iter()) {
        let mut document = Document::load_mem(bytes).map_err(|_| "signature_bundle_invalid_pdf")?;
        if document.is_encrypted() {
            return Err("signature_bundle_invalid_pdf");
        }
        document.renumber_objects_with(next_id);
        next_id = document
            .objects
            .keys()
            .map(|id| id.0)
            .max()
            .map_or(next_id, |max| max + 1);
        let pages = document.get_pages();
        if pages.is_empty() {
            return Err("signature_bundle_invalid_pdf");
        }
        // A page may inherit these from its parent `Pages` node, which is
        // replaced below, so pin them on the page itself first.
        for page_id in pages.values() {
            let mut inherited = Vec::new();
            for key in [&b"Resources"[..], b"MediaBox", b"CropBox", b"Rotate"] {
                let page = document
                    .get_dictionary(*page_id)
                    .map_err(|_| "signature_bundle_invalid_pdf")?;
                if page.has(key) {
                    continue;
                }
                let mut parent = page.get(b"Parent").and_then(Object::as_reference).ok();
                while let Some(parent_id) = parent {
                    let Ok(node) = document.get_dictionary(parent_id) else {
                        break;
                    };
                    if let Ok(value) = node.get(key) {
                        inherited.push((key.to_vec(), value.clone()));
                        break;
                    }
                    parent = node.get(b"Parent").and_then(Object::as_reference).ok();
                }
            }
            let page = document
                .get_dictionary_mut(*page_id)
                .map_err(|_| "signature_bundle_invalid_pdf")?;
            for (key, value) in inherited {
                page.set(key, value);
            }
        }
        page_ids.extend(pages.values().copied());
        for (id, object) in std::mem::take(&mut document.objects) {
            let node_type = object
                .as_dict()
                .ok()
                .and_then(|dict| dict.get(b"Type").ok())
                .and_then(|value| value.as_name().ok());
            // The bundle gets one fresh catalog and page tree; outlines would
            // point into a tree that no longer exists.
            if matches!(
                node_type,
                Some(b"Catalog") | Some(b"Pages") | Some(b"Outlines") | Some(b"Outline")
            ) {
                continue;
            }
            merged.objects.insert(id, object);
        }
    }

    let pages_id: ObjectId = (next_id, 0);
    let catalog_id: ObjectId = (next_id + 1, 0);
    for page_id in &page_ids {
        let page = merged
            .get_dictionary_mut(*page_id)
            .map_err(|_| "signature_bundle_invalid_pdf")?;
        page.set("Parent", pages_id);
    }
    let mut pages = Dictionary::new();
    pages.set("Type", Object::Name(b"Pages".to_vec()));
    pages.set("Count", page_ids.len() as i64);
    pages.set(
        "Kids",
        page_ids
            .iter()
            .map(|id| Object::Reference(*id))
            .collect::<Vec<_>>(),
    );
    merged.objects.insert(pages_id, Object::Dictionary(pages));
    let mut catalog = Dictionary::new();
    catalog.set("Type", Object::Name(b"Catalog".to_vec()));
    catalog.set("Pages", pages_id);
    merged
        .objects
        .insert(catalog_id, Object::Dictionary(catalog));
    merged.trailer.set("Root", catalog_id);
    merged.max_id = catalog_id.0;

    let mut bytes = Vec::new();
    merged
        .save_to(&mut bytes)
        .map_err(|_| "signature_bundle_invalid_pdf")?;
    if bytes.len() > provider::MAX_PDF || !bytes.starts_with(b"%PDF-") {
        return Err("signature_bundle_too_large");
    }
    Ok(bytes)
}

async fn current_row<'e, E>(executor: E, id: Uuid, lock: bool) -> Result<PgRow, &'static str>
where
    E: sqlx::PgExecutor<'e>,
{
    let sql = if lock {
        "SELECT *, NOT EXISTS(SELECT 1 FROM documents v WHERE v.replaces_document_id=d.id) AS is_latest_version FROM documents d WHERE id=$1 FOR UPDATE"
    } else {
        "SELECT *, NOT EXISTS(SELECT 1 FROM documents v WHERE v.replaces_document_id=d.id) AS is_latest_version FROM documents d WHERE id=$1"
    };
    sqlx::query(sql)
        .bind(id)
        .fetch_one(executor)
        .await
        .map_err(|_| "signature_database_error")
}

/// Whether a stored document still has the context and bytes it was sent
/// with. A storage read error is returned as an error (transient), not as a
/// change.
async fn unchanged(row: &PgRow, context_value: &Value, hash: &str) -> Result<bool, &'static str> {
    if eligibility(row).is_some() || context(row) != *context_value {
        return Ok(false);
    }
    Ok(current_source_bytes(row)
        .await?
        .is_some_and(|bytes| sha256(&bytes) == hash))
}

pub(super) async fn signing_sources_current(
    state: &AppState,
    request: &PgRow,
    source: &PgRow,
) -> Result<bool, &'static str> {
    let primary_hash = request
        .get::<Option<String>, _>("primary_source_sha256")
        .unwrap_or_else(|| request.get::<String, _>("source_sha256"));
    if !unchanged(
        source,
        &request.get::<Value, _>("source_context"),
        &primary_hash,
    )
    .await?
    {
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
        let current = current_row(&state.db, member.get("document_id"), false).await?;
        if !unchanged(
            &current,
            &member.get::<Value, _>("source_context"),
            &member.get::<String, _>("sha256"),
        )
        .await?
        {
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
    let primary_hash = request
        .get::<Option<String>, _>("primary_source_sha256")
        .unwrap_or_else(|| request.get::<String, _>("source_sha256"));
    if !unchanged(
        source,
        &request.get::<Value, _>("source_context"),
        &primary_hash,
    )
    .await?
    {
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
        let current = current_row(&mut **tx, member.get("document_id"), true).await?;
        if !unchanged(
            &current,
            &member.get::<Value, _>("source_context"),
            &member.get::<String, _>("sha256"),
        )
        .await?
        {
            return Ok(false);
        }
    }
    Ok(true)
}

/// An informational attachment fixed before anyone is invited.
pub(super) struct Prepared {
    pub(super) row: PgRow,
    pub(super) hash: String,
    pub(super) filename: String,
}

/// The cost calculation belongs to the order of the cost estimate it explains;
/// the privacy information to the patient or lead.
pub(super) fn attachment_scope_matches(template: &str, members: &[&PgRow], row: &PgRow) -> bool {
    let Some(first) = members.first() else {
        return false;
    };
    if !same_scope(first, row) {
        return false;
    }
    if template != "cost_estimate" {
        return true;
    }
    let order: Option<Uuid> = row.get("order_id");
    order.is_some()
        && members.iter().any(|member| {
            companion(template_of(member).as_deref()) == Some("cost_estimate")
                && member.get::<Option<Uuid>, _>("order_id") == order
        })
}

/// Whether a current medical cost calculation exists for the order of a cost
/// estimate in the package. Orders without medical work types have none.
async fn cost_calculation_available(
    state: &AppState,
    auth: &AuthUser,
    members: &[&PgRow],
) -> Result<bool, Response> {
    let Some(first) = members.first() else {
        return Ok(false);
    };
    for id in scope_documents(state, first, &["cost_estimate"]).await? {
        if let Ok(row) = signature_document_access(state, auth, id, false).await
            && attachment_scope_matches("cost_estimate", members, &row)
            && eligibility(&row).is_none()
        {
            return Ok(true);
        }
    }
    Ok(false)
}

/// The read-only companions a server-assembled package needs, chosen like a
/// composer would: per companion template the members require, the newest
/// eligible document of the same scope (for the medical cost calculation: of
/// the order of the cost estimate). A cost calculation that does not exist is
/// left out, as [`prepare_attachments`] allows; a missing privacy information
/// is left to [`prepare_attachments`] to refuse.
pub(super) async fn required_attachment_ids(
    state: &AppState,
    auth: &AuthUser,
    members: &[&PgRow],
) -> Result<Vec<Uuid>, Response> {
    let Some(first) = members.first() else {
        return Ok(Vec::new());
    };
    let mut required: Vec<&'static str> = Vec::new();
    for member in members {
        if let Some(template) = companion(template_of(member).as_deref())
            && !required.contains(&template)
        {
            required.push(template);
        }
    }
    let mut ids = Vec::new();
    for template in required {
        for id in scope_documents(state, first, &[template]).await? {
            if let Ok(row) = signature_document_access(state, auth, id, false).await
                && attachment_scope_matches(template, members, &row)
                && eligibility(&row).is_none()
            {
                ids.push(id);
                break;
            }
        }
    }
    Ok(ids)
}

/// Validates the informational attachments of a request. Every companion the
/// signed documents require must be attached (Art. 13/14 DSGVO information,
/// the medical cost calculation); nothing else may be. The cost calculation is
/// required whenever the order of the cost estimate has one; an order without
/// medical work types has none, and its cost estimate is signed without it.
pub(super) async fn prepare_attachments(
    state: &AppState,
    auth: &AuthUser,
    members: &[&PgRow],
    selected: &[Uuid],
) -> Result<Vec<Prepared>, Response> {
    let mut required: Vec<&'static str> = Vec::new();
    for member in members {
        if let Some(template) = companion(template_of(member).as_deref())
            && !required.contains(&template)
        {
            required.push(template);
        }
    }
    if required.contains(&"cost_estimate")
        && !cost_calculation_available(state, auth, members).await?
    {
        required.retain(|template| *template != "cost_estimate");
    }
    let mut unique = selected.to_vec();
    unique.sort();
    unique.dedup();
    if unique.len() != selected.len() {
        return Err(error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "duplicate_review_attachment",
        ));
    }
    if selected.len() > required.len() {
        return Err(error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "unexpected_review_attachment",
        ));
    }
    let mut rows = Vec::with_capacity(selected.len());
    for id in selected {
        rows.push(signature_document_access(state, auth, *id, false).await?);
    }
    let mut prepared = Vec::with_capacity(required.len());
    for template in required {
        let Some(position) = rows
            .iter()
            .position(|row| template_of(row).as_deref() == Some(template))
        else {
            // A document of another type was selected for this companion.
            if !rows.is_empty()
                && rows.iter().all(|row| {
                    !template_of(row)
                        .as_deref()
                        .is_some_and(legal::informational_template)
                })
            {
                return Err(error(StatusCode::CONFLICT, "review_attachment_changed"));
            }
            return Err(error(
                StatusCode::UNPROCESSABLE_ENTITY,
                "review_attachment_required",
            ));
        };
        let row = rows.swap_remove(position);
        let id: Uuid = row.get("id");
        if !attachment_scope_matches(template, members, &row) || eligibility(&row).is_some() {
            return Err(document_error(
                StatusCode::CONFLICT,
                "review_attachment_changed",
                id,
            ));
        }
        let bytes = source_bytes(&row)
            .await
            .map_err(|e| document_error(StatusCode::UNPROCESSABLE_ENTITY, e, id))?;
        scan_upload_bytes(Some("attachment.pdf"), &bytes)
            .await
            .map_err(|_| {
                document_error(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "signature_scan_failed",
                    id,
                )
            })?;
        let version: i32 = row.get("version_number");
        let title = if template == "privacy_information" {
            "Datenschutzinformation"
        } else {
            "Vorlaeufige-medizinische-Kostenkalkulation"
        };
        prepared.push(Prepared {
            hash: sha256(&bytes),
            filename: format!("{title}-v{version}-{id}.pdf"),
            row,
        });
    }
    if let Some(row) = rows.first() {
        return Err(
            if template_of(row)
                .as_deref()
                .is_some_and(legal::informational_template)
            {
                error(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "unexpected_review_attachment",
                )
            } else {
                error(StatusCode::CONFLICT, "review_attachment_changed")
            },
        );
    }
    Ok(prepared)
}

pub(super) async fn persist(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    request_id: Uuid,
    prepared: &Prepared,
    position: i16,
) -> Result<(), Response> {
    let id: Uuid = prepared.row.get("id");
    let current = current_row(&mut **tx, id, true)
        .await
        .map_err(|e| error(StatusCode::INTERNAL_SERVER_ERROR, e))?;
    if eligibility(&current).is_some() || context(&current) != context(&prepared.row) {
        return Err(document_error(
            StatusCode::CONFLICT,
            "review_attachment_changed",
            id,
        ));
    }
    sqlx::query("INSERT INTO document_signature_attachments(request_id,document_id,filename,sha256,source_context,position) VALUES ($1,$2,$3,$4,$5,$6)")
        .bind(request_id).bind(id).bind(&prepared.filename).bind(&prepared.hash).bind(context(&prepared.row)).bind(position)
        .execute(&mut **tx).await.map_err(db_error)?;
    Ok(())
}

pub(super) async fn rows(state: &AppState, id: Uuid) -> Result<Vec<PgRow>, &'static str> {
    sqlx::query(
        "SELECT * FROM document_signature_attachments WHERE request_id=$1 ORDER BY position",
    )
    .bind(id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| "signature_database_error")
}

pub(super) async fn has_attachments(state: &AppState, id: Uuid) -> Result<bool, &'static str> {
    sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM document_signature_attachments WHERE request_id=$1)",
    )
    .bind(id)
    .fetch_one(&state.db)
    .await
    .map_err(|_| "signature_database_error")
}

/// The provider's attachment ID for one of our files. The remote list may
/// contain only our own attachments, each once.
fn attachment_id(value: &Value, filename: &str) -> Result<Option<Uuid>, &'static str> {
    let Some(values) = value["attachments"].as_array() else {
        return Ok(None);
    };
    let mut matching = values.iter().filter(|v| v["filename"] == filename);
    let Some(found) = matching.next() else {
        return Ok(None);
    };
    if matching.next().is_some() {
        return Err("review_attachment_mismatch");
    }
    found["attachment_id"]
        .as_str()
        .and_then(|v| Uuid::parse_str(v).ok())
        .map(Some)
        .ok_or("review_attachment_mismatch")
}

fn remote_attachment_count(value: &Value) -> usize {
    value["attachments"].as_array().map_or(0, Vec::len)
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
    let attachments = rows(state, id).await?;
    if attachments.is_empty() {
        return Ok(value);
    }
    let level = request_level(request);
    let language = request
        .try_get::<String, _>("language")
        .unwrap_or_else(|_| "de".into());
    let hash: String = request.get("source_sha256");
    let empty = value["signatures"].as_array().is_some_and(|s| s.is_empty());
    let verified = provider.validate_level(
        &value,
        id,
        &hash,
        request.get("provider_request_id"),
        if empty { &[] } else { signers },
        level,
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
    if remote_attachment_count(&value) > attachments.len() {
        return Err("review_attachment_mismatch");
    }
    if attachments
        .iter()
        .all(|attachment| attachment.get::<String, _>("stage") == "sent")
    {
        for attachment in &attachments {
            let attached = attachment_id(&value, &attachment.get::<String, _>("filename"))?;
            if attached.is_none()
                || attached != attachment.get::<Option<Uuid>, _>("provider_attachment_id")
            {
                return Err("review_attachment_mismatch");
            }
        }
        return Ok(value);
    }
    let mut attached_ids = Vec::with_capacity(attachments.len());
    for attachment in &attachments {
        let document_id: Uuid = attachment.get("document_id");
        let filename: String = attachment.get("filename");
        let expected_hash: String = attachment.get("sha256");
        let stage: String = attachment.get("stage");
        let mut attached = attachment_id(&value, &filename)?;
        if attached.is_none() {
            if stage != "prepared" || !empty {
                return Err("review_package_submission_unknown");
            }
            let source = current_row(&state.db, document_id, false).await?;
            if !unchanged(
                &source,
                &attachment.get::<Value, _>("source_context"),
                &expected_hash,
            )
            .await?
            {
                return Err("review_attachment_changed");
            }
            let bytes = source_bytes(&source).await?;
            set_stage(state, id, document_id, "attaching", None).await?;
            value = provider.add_attachment(remote, &filename, &bytes).await?;
            // Attachment endpoints may return a partial request; use an authoritative GET.
            let _ = value;
            value = provider.get(remote).await?;
            provider.validate_level(&value, id, &hash, Some(remote), &[], level)?;
            attached = attachment_id(&value, &filename)?;
        }
        let attachment_id = attached.ok_or("review_attachment_mismatch")?;
        let bytes = provider.attachment_content(remote, attachment_id).await?;
        if sha256(&bytes) != expected_hash {
            return Err("review_attachment_mismatch");
        }
        if matches!(stage.as_str(), "prepared" | "attaching") {
            set_stage(state, id, document_id, "attached", Some(attachment_id)).await?;
        }
        attached_ids.push((document_id, attachment_id, stage));
    }
    if empty {
        if attached_ids
            .iter()
            .any(|(_, _, stage)| !matches!(stage.as_str(), "prepared" | "attaching" | "attached"))
        {
            return Err("review_package_submission_unknown");
        }
        // A manager may have replaced a PDF while preparation was running.
        // Do not invite recipients to an obsolete or reassigned package.
        let primary = current_row(&state.db, request.get("source_document_id"), false).await?;
        if !signing_sources_current(state, request, &primary).await? {
            return Err("signing_document_changed");
        }
        for attachment in &attachments {
            let current = current_row(&state.db, attachment.get("document_id"), false).await?;
            if !unchanged(
                &current,
                &attachment.get::<Value, _>("source_context"),
                &attachment.get::<String, _>("sha256"),
            )
            .await?
            {
                return Err("review_attachment_changed");
            }
        }
        for (document_id, attachment_id, _) in &attached_ids {
            set_stage(state, id, *document_id, "inviting", Some(*attachment_id)).await?;
        }
        // A timeout here cannot be retried; subsequent GET must prove whether the
        // recipients were added. Until then no Sent/Acknowledged status is inferred.
        value = provider.invite_in(remote, signers, &language).await?;
    }
    provider.validate_level(&value, id, &hash, Some(remote), signers, level)?;
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| "signature_database_error")?;
    for (document_id, attachment_id, _) in &attached_ids {
        // Serialize manual acknowledgement with a new delivery of this same version.
        sqlx::query("SELECT id FROM documents WHERE id=$1 FOR UPDATE")
            .bind(document_id)
            .execute(&mut *tx)
            .await
            .map_err(|_| "signature_database_error")?;
        sqlx::query("UPDATE document_signature_attachments SET stage='sent',provider_attachment_id=$3 WHERE request_id=$1 AND document_id=$2")
            .bind(id).bind(document_id).bind(attachment_id).execute(&mut *tx).await.map_err(|_| "signature_database_error")?;
        sqlx::query("INSERT INTO document_review_events(id,document_id,kind,actor_id,signature_request_id,test_mode) VALUES ($1,$2,'sent',$3,$4,$5) ON CONFLICT DO NOTHING")
            .bind(Uuid::new_v4()).bind(document_id).bind(request.get::<Uuid,_>("requested_by"))
            .bind(id).bind(request.get::<bool,_>("test_mode")).execute(&mut *tx).await.map_err(|_| "signature_database_error")?;
    }
    tx.commit().await.map_err(|_| "signature_database_error")?;
    Ok(value)
}

async fn set_stage(
    state: &AppState,
    id: Uuid,
    document_id: Uuid,
    stage: &str,
    remote: Option<Uuid>,
) -> Result<(), &'static str> {
    sqlx::query("UPDATE document_signature_attachments SET stage=$3,provider_attachment_id=COALESCE($4,provider_attachment_id) WHERE request_id=$1 AND document_id=$2")
        .bind(id).bind(document_id).bind(stage).bind(remote).execute(&state.db).await.map_err(|_| "signature_database_error")?;
    Ok(())
}

/// Fill each signer's Skribble visual-signature frames from the anchors of
/// every document (recorded by the generator, or found in the PDF of an older
/// generated document), translated to pages of the merged bundle (in bundle
/// order). Documents without page count contribute no frames.
pub(super) async fn assign_visual_positions(
    documents: &[(&PgRow, &[u8], Option<usize>)],
    signers: &mut [Signer],
) {
    let mut anchored: Vec<(Vec<SignatureAnchor>, usize)> = Vec::with_capacity(documents.len());
    for (row, pdf, pages) in documents {
        anchored.push((
            if pages.is_some() {
                signature_anchors_of(row, pdf).await
            } else {
                Vec::new()
            },
            pages.unwrap_or(0),
        ));
    }
    let roles = signers.iter().map(|signer| signer.role.clone()).collect();
    for (signer, positions) in signers.iter_mut().zip(visual_positions(&anchored, roles)) {
        signer.positions = positions;
    }
}

/// The anchors the generator recorded with the document.
fn recorded_anchors(row: &PgRow) -> Vec<SignatureAnchor> {
    row.try_get::<Option<Value>, _>("generated_bindings")
        .ok()
        .flatten()
        .and_then(|bindings| {
            serde_json::from_value(bindings.get(SIGNATURE_ANCHORS_BINDING_KEY)?.clone()).ok()
        })
        .unwrap_or_default()
}

/// A generated document from before the generators recorded their anchors:
/// its signature lines are found in the PDF itself. Uploaded PDFs are never
/// searched; their signers place the signature themselves.
fn needs_frame_detection(row: &PgRow) -> bool {
    recorded_anchors(row).is_empty()
        && row
            .try_get::<Option<String>, _>("generated_template_id")
            .ok()
            .flatten()
            .is_some()
}

/// The anchors recorded with the document, or, for an older generated
/// document without a record, the signature places found in its PDF, so its
/// signers do not have to place the signature by hand.
pub(super) async fn signature_anchors_of(row: &PgRow, pdf: &[u8]) -> Vec<SignatureAnchor> {
    if !needs_frame_detection(row) {
        return recorded_anchors(row);
    }
    let pdf = pdf.to_vec();
    tokio::task::spawn_blocking(move || super::frames::detect_signature_anchors(&pdf))
        .await
        .unwrap_or_default()
}

fn mm_to_pdf_points(value_mm: f32) -> i64 {
    (f64::from(value_mm) * 72.0 / 25.4).round() as i64
}

/// One list of frames per signer, in signer order; no frame is given to two
/// signers. Per document, the first client signer takes the `client` frame;
/// in a document without one (minors' consents) client signer N takes
/// `guardian_N`, and where both exist, further client signers take the
/// `guardian_N` frames. The first agency signer takes the `agency` frame. A
/// signer without a frame signs where the provider places the signature.
pub(super) fn visual_positions(
    documents: &[(Vec<SignatureAnchor>, usize)],
    roles: Vec<String>,
) -> Vec<Vec<Value>> {
    let mut ordinals: HashMap<String, usize> = HashMap::new();
    roles
        .iter()
        .map(|role| {
            let ordinal = {
                let counter = ordinals.entry(role.clone()).or_default();
                *counter += 1;
                *counter
            };
            let mut frames = Vec::new();
            let mut page_offset = 0;
            for (anchors, page_count) in documents {
                let has_client = anchors.iter().any(|anchor| anchor.role == "client");
                let wanted: Option<String> = match role.as_str() {
                    "client" if ordinal == 1 && has_client => Some("client".into()),
                    "client" => Some(format!("guardian_{ordinal}")),
                    other if ordinal == 1 => Some(other.to_string()),
                    _ => None,
                };
                for anchor in anchors {
                    if wanted.as_deref() == Some(anchor.role.as_str()) && anchor.page < *page_count
                    {
                        frames.push(json!({
                            "page": (page_offset + anchor.page).to_string(),
                            "x": mm_to_pdf_points(anchor.x_mm),
                            "y": mm_to_pdf_points(anchor.y_mm),
                            "width": mm_to_pdf_points(anchor.width_mm),
                            "height": mm_to_pdf_points(anchor.height_mm),
                        }));
                    }
                }
                page_offset += page_count;
            }
            frames
        })
        .collect()
}

/// The frame roles a stored document provides, for the composer's warnings:
/// recorded anchors, or frames found in the PDF of an older generated
/// document (its file is read only in that case).
pub(super) async fn frame_roles(row: &PgRow) -> Vec<String> {
    let anchors = if needs_frame_detection(row) {
        match source_bytes(row).await {
            Ok(bytes) => signature_anchors_of(row, &bytes).await,
            Err(_) => Vec::new(),
        }
    } else {
        recorded_anchors(row)
    };
    let mut roles: Vec<String> = anchors.into_iter().map(|anchor| anchor.role).collect();
    roles.sort();
    roles.dedup();
    roles
}

#[cfg(test)]
mod tests {
    use super::*;
    use printpdf::{Mm, PdfDocument, PdfPage, PdfParseOptions, PdfSaveOptions};
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
        // Lead intake sends the whole onboarding package from the contract,
        // with the lead's patient form; an existing patient's contract or
        // order is still signed on its own.
        assert_eq!(
            signing_companions(Some("framework_contract"), true),
            [
                "single_order",
                "lead_self_disclosure",
                "confidentiality_release",
                "privacy_consents"
            ]
        );
        assert!(signing_companions(Some("framework_contract"), false).is_empty());
        // Without a new contract the order carries the patient form and the
        // consents of the lead.
        assert_eq!(
            signing_companions(Some("single_order"), true),
            [
                "lead_self_disclosure",
                "confidentiality_release",
                "privacy_consents"
            ]
        );
        assert!(signing_companions(Some("single_order"), false).is_empty());
        assert!(signing_companions(Some("lead_self_disclosure"), true).is_empty());
        assert_eq!(
            signing_slots(Some("single_order"), true, true),
            vec![&["lead_self_disclosure"][..], MINOR_CONSENTS]
        );
        // A minor's onboarding package carries the child's patient form and
        // the guardians' declaration.
        assert_eq!(
            signing_slots(Some("framework_contract"), true, true),
            vec![
                &["single_order"][..],
                &["lead_self_disclosure"][..],
                MINOR_CONSENTS
            ]
        );
        assert_eq!(
            signing_slots(Some("framework_contract"), true, false).len(),
            4
        );
        // The patient form exists only after the lead sent the request: its
        // slot may stay empty, every other one may not.
        assert!(optional_slot(&["lead_self_disclosure"]));
        assert!(!optional_slot(&["single_order"]));
        assert!(!optional_slot(MINOR_CONSENTS));
        assert!(!optional_slot(&[]));
        let id = Uuid::new_v4();
        assert_eq!(
            attachment_id(
                &json!({"attachments":[{"filename":"a.pdf","attachment_id":id}]}),
                "a.pdf"
            )
            .unwrap(),
            Some(id)
        );
        assert_eq!(
            attachment_id(
                &json!({"attachments":[{"filename":"b.pdf","attachment_id":id}]}),
                "a.pdf"
            )
            .unwrap(),
            None
        );
        assert!(attachment_id(&json!({"attachments":[{"filename":"a.pdf","attachment_id":id},{"filename":"a.pdf","attachment_id":id}]}), "a.pdf").is_err());
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
        let facts = inspect_pdf(&merged);
        assert_eq!(facts.pages, Some(8));
        assert!(!facts.signed);
        let alone = pdf(2);
        assert_eq!(merge_signing_pdfs(&alone, &[]).unwrap(), alone);
    }

    #[test]
    fn already_signed_pdfs_are_detected() {
        let unparseable = b"%PDF-1.7\n1 0 obj << /Type /Sig /ByteRange [0 1 2 3] >> endobj\n%%EOF";
        assert!(inspect_pdf(unparseable).signed);
        assert_eq!(inspect_pdf(unparseable).pages, None);
        assert!(!inspect_pdf(b"%PDF-1.7\nplain\n%%EOF").signed);
    }

    #[test]
    fn signing_bundle_keeps_text_readable() {
        use crate::services::patient_medication_pdf::{
            MedicationPlanContext, build_medication_plan_pdf,
        };
        fn pdf(patient_name: &str) -> Vec<u8> {
            build_medication_plan_pdf(&MedicationPlanContext {
                patient_name: patient_name.into(),
                ..Default::default()
            })
            .unwrap()
        }
        let (contract, order) = (pdf("Rahmenvertrag Müller"), pdf("Auftrag Приклад"));
        let merged = merge_signing_pdfs(&contract, &[order.as_slice()]).unwrap();
        let text = pdf_extract::extract_text_from_mem(&merged).unwrap();
        assert!(text.contains("Rahmenvertrag Müller"), "{text}");
        assert!(text.contains("Auftrag Приклад"), "{text}");
        // Both members keep their own embedded font programs.
        let fonts = |bytes: &[u8]| bytes.windows(9).filter(|w| w == b"FontFile2").count();
        assert_eq!(fonts(&merged), fonts(&contract) + fonts(&order));
    }
}

#[cfg(test)]
mod visual_position_tests {
    use super::*;

    fn anchor(role: &str, page: usize, x_mm: f32, y_mm: f32) -> SignatureAnchor {
        SignatureAnchor {
            role: role.into(),
            page,
            x_mm,
            y_mm,
            width_mm: 60.0,
            height_mm: 10.5,
        }
    }

    #[test]
    fn frames_follow_the_bundle_page_offsets_and_signer_roles() {
        // Source: 2 pages, both parties sign on its last page. Member: 3 pages,
        // client signs on page 1 of the member (bundle page 3).
        let documents = vec![
            (
                vec![
                    anchor("client", 1, 25.0, 40.0),
                    anchor("agency", 1, 110.0, 40.0),
                ],
                2,
            ),
            (vec![anchor("client", 0, 147.0, 60.0)], 3),
        ];
        let positions = visual_positions(&documents, vec!["client".into(), "agency".into()]);
        assert_eq!(positions[0].len(), 2);
        assert_eq!(positions[0][0]["page"], "1");
        assert_eq!(positions[0][1]["page"], "2");
        assert_eq!(positions[0][0]["x"], 71); // 25 mm
        assert_eq!(positions[0][0]["width"], 170); // 60 mm
        assert_eq!(positions[1].len(), 1);
        assert_eq!(positions[1][0]["page"], "1");
        assert_eq!(positions[1][0]["x"], 312); // 110 mm
    }

    #[test]
    fn guardians_take_the_numbered_frames_when_no_client_frame_exists() {
        let documents = vec![(
            vec![
                anchor("guardian_1", 0, 147.0, 80.0),
                anchor("guardian_2", 0, 147.0, 60.0),
            ],
            1,
        )];
        let positions = visual_positions(
            &documents,
            vec!["client".into(), "client".into(), "agency".into()],
        );
        assert_eq!(positions[0][0]["y"], mm_to_pdf_points(80.0));
        assert_eq!(positions[1][0]["y"], mm_to_pdf_points(60.0));
        assert!(positions[2].is_empty());
    }

    #[test]
    fn no_two_signers_share_a_frame() {
        // Contract with one client frame, then the guardians' declaration.
        let documents = vec![
            (
                vec![
                    anchor("client", 0, 25.0, 40.0),
                    anchor("agency", 0, 110.0, 40.0),
                ],
                1,
            ),
            (
                vec![
                    anchor("guardian_1", 0, 25.0, 80.0),
                    anchor("guardian_2", 0, 25.0, 60.0),
                ],
                1,
            ),
        ];
        let positions = visual_positions(
            &documents,
            vec![
                "client".into(),
                "client".into(),
                "agency".into(),
                "agency".into(),
                "minor".into(),
            ],
        );
        // First guardian: contract client frame and guardian_1 of the declaration.
        assert_eq!(positions[0].len(), 2);
        assert_eq!(positions[0][1]["page"], "1");
        // Second guardian: only guardian_2, never the contract's client frame.
        assert_eq!(positions[1].len(), 1);
        assert_eq!(positions[1][0]["y"], mm_to_pdf_points(60.0));
        assert_eq!(positions[2].len(), 1);
        assert!(positions[3].is_empty(), "second agency signer has no frame");
        assert!(positions[4].is_empty(), "the minor has no generated frame");
        let mut taken = positions
            .iter()
            .flatten()
            .map(|f| f.to_string())
            .collect::<Vec<_>>();
        let total = taken.len();
        taken.sort();
        taken.dedup();
        assert_eq!(taken.len(), total);
    }

    #[test]
    fn the_payer_signs_in_its_own_frame() {
        let documents = vec![(
            vec![
                anchor("payer", 0, 25.0, 40.0),
                anchor("agency", 0, 110.0, 40.0),
            ],
            1,
        )];
        let positions = visual_positions(&documents, vec!["payer".into(), "agency".into()]);
        assert_eq!(positions[0][0]["x"], mm_to_pdf_points(25.0));
        assert_eq!(positions[1][0]["x"], mm_to_pdf_points(110.0));
        // A client signer never takes the payer frame.
        assert!(visual_positions(&documents, vec!["client".into()])[0].is_empty());
    }

    #[test]
    fn anchors_outside_the_document_are_dropped() {
        let documents = vec![(vec![anchor("client", 4, 25.0, 40.0)], 2)];
        assert!(visual_positions(&documents, vec!["client".into()])[0].is_empty());
    }
}
