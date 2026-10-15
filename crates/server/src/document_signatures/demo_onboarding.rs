//! DEV workflow evidence, separate from the legal effects of a live signature.
use super::*;

/// Only archived, completed DEMO signatures on unchanged current sources count.
/// This never writes a signed flag or calls the provider.
pub(crate) async fn current_documents(
    state: &AppState,
    lead_id: Uuid,
) -> Result<Vec<PgRow>, &'static str> {
    if !state.dev_demo_onboarding {
        return Ok(Vec::new());
    }
    let requests = sqlx::query(
        r#"SELECT r.* FROM document_signature_requests r
           JOIN documents source ON source.id = r.source_document_id
           JOIN documents result ON result.id = r.result_document_id
           WHERE source.lead_id = $1 AND r.test_mode AND r.status = 'completed'
             AND result.status = 'active' AND result.file_deleted_at IS NULL
             AND result.storage_key IS NOT NULL
             AND r.report_storage_key IS NOT NULL
             AND NOT EXISTS (
                 SELECT 1 FROM documents d JOIN orders o ON o.id = d.order_id
                 WHERE (d.id = r.source_document_id OR d.id IN (
                            SELECT m.document_id FROM document_signature_members m
                            WHERE m.request_id = r.id))
                   AND d.generated_template_id = 'single_order'
                   AND (o.source_lead_id IS DISTINCT FROM $1
                        OR o.id IS DISTINCT FROM (
                            SELECT latest.id FROM orders latest WHERE latest.source_lead_id = $1
                            ORDER BY latest.created_at DESC, latest.id DESC LIMIT 1)
                        OR d.created_at <= o.client_terms_changed_at)
             )
           ORDER BY r.created_at DESC, r.id DESC"#,
    )
    .bind(lead_id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| "signature_database_error")?;
    let mut proofs = Vec::new();
    'requests: for request in requests {
        let source =
            package::current_row(&state.db, request.get("source_document_id"), false).await?;
        if !package::signing_sources_current(state, &request, &source).await? {
            continue;
        }
        let mut documents = sqlx::query(
            r#"SELECT d.*, $2::uuid AS demo_request_id FROM documents d
               WHERE d.lead_id = $1 AND (d.id = $3 OR d.id IN (
                   SELECT m.document_id FROM document_signature_members m WHERE m.request_id = $2))"#,
        )
        .bind(lead_id)
        .bind(request.get::<Uuid, _>("id"))
        .bind(request.get::<Uuid, _>("source_document_id"))
        .fetch_all(&state.db)
        .await
        .map_err(|_| "signature_database_error")?;
        for document in &documents {
            if crate::consent_choices::changed_since_generation(
                &state.db,
                document
                    .get::<Option<String>, _>("generated_template_id")
                    .as_deref(),
                document
                    .get::<Option<Value>, _>("generated_bindings")
                    .as_ref(),
                document.get("lead_id"),
                document.get("patient_id"),
            )
            .await
            .map_err(|_| "signature_database_error")?
            .is_some()
            {
                continue 'requests;
            }
        }
        proofs.append(&mut documents);
    }
    Ok(proofs)
}
