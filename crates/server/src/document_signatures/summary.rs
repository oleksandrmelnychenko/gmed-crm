use super::*;
use axum::extract::Query;

#[derive(Deserialize)]
pub(super) struct SummaryQuery {
    ids: String,
}

// Compact, batched status for document actions. Never expose recipients or
// provider evidence in lists, and retain the same ACL as the signing workspace.
pub(super) async fn list(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<SummaryQuery>,
) -> Result<Json<Value>, Response> {
    auth.require_exact_role(&[
        gmed_domain::role::Role::Ceo,
        gmed_domain::role::Role::PatientManager,
        gmed_domain::role::Role::ItAdmin,
    ])?;
    let ids = query
        .ids
        .split(',')
        .map(Uuid::parse_str)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| error(StatusCode::BAD_REQUEST, "invalid_document_ids"))?;
    if ids.is_empty() || ids.len() > 100 {
        return Err(error(StatusCode::BAD_REQUEST, "invalid_document_ids"));
    }
    let rows = sqlx::query(
        "SELECT DISTINCT ON (document_id) document_id, status, test_mode, result_document_id
         FROM (
           SELECT source_document_id AS document_id, status, test_mode, result_document_id, created_at, id
           FROM document_signature_requests WHERE source_document_id = ANY($1)
           UNION ALL
           SELECT result_document_id AS document_id, status, test_mode, result_document_id, created_at, id
           FROM document_signature_requests WHERE result_document_id = ANY($1)
         ) requests ORDER BY document_id, created_at DESC, id DESC"
    ).bind(&ids).fetch_all(&state.db).await.map_err(db_error)?;
    let mut summaries = Vec::new();
    for row in rows {
        let id: Uuid = row.get("document_id");
        if signature_document_access(&state, &auth, id, false)
            .await
            .is_err()
        {
            continue;
        }
        summaries.push(json!({
            "document_id": id,
            "status": row.get::<String,_>("status"),
            "test_mode": row.get::<bool,_>("test_mode"),
            "result_document_id": row.get::<Option<Uuid>,_>("result_document_id")
        }));
    }
    Ok(Json(json!(summaries)))
}
