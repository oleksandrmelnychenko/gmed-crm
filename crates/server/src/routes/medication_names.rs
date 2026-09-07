use axum::{
    Json, Router,
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, patch},
};
use gmed_domain::role::Role;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::PgConnection;
use uuid::Uuid;

use crate::{audit::AuditContext, auth::middleware::AuthUser, state::AppState};

const MAX_NAME_LENGTH: usize = 500;
const SUGGESTION_LIMIT: usize = 50;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/medication-names", get(search_names))
        .route("/medication-name-pairs", get(list_pairs).post(create_pair))
        .route("/medication-name-pairs/check", get(check_pair))
        .route("/medication-name-pairs/{id}", patch(update_pair))
}

#[derive(Serialize, sqlx::FromRow)]
struct NamePair {
    id: Uuid,
    handelsname: String,
    wirkstoff: String,
    version: i32,
}

#[derive(Deserialize, Default)]
struct CatalogQuery {
    #[serde(default)]
    q: String,
    page: Option<u32>,
    page_size: Option<u32>,
}

#[derive(Deserialize)]
pub(crate) struct PairInput {
    handelsname: String,
    wirkstoff: String,
}

impl PairInput {
    pub(crate) fn confirms(&self, handelsname: &str, wirkstoff: &str) -> bool {
        search_key(&self.handelsname) == search_key(handelsname)
            && search_key(&self.wirkstoff) == search_key(wirkstoff)
    }
}

#[derive(Serialize)]
struct NameReview {
    exact: Option<String>,
    similar: Vec<String>,
}

// Bounded spelling suggestions only. Similarity never establishes drug identity
// and never changes or combines stored names without an explicit user choice.
fn spelling_distance(left: &str, right: &str, limit: usize) -> Option<usize> {
    let left: Vec<char> = left.chars().collect();
    let right: Vec<char> = right.chars().collect();
    if left.len().abs_diff(right.len()) > limit {
        return None;
    }
    let mut previous: Vec<usize> = (0..=right.len()).collect();
    let mut before_previous = previous.clone();
    for (i, left_char) in left.iter().enumerate() {
        let mut current = vec![limit + 1; right.len() + 1];
        current[0] = i + 1;
        let start = (i + 1).saturating_sub(limit).max(1);
        let end = (i + 1 + limit).min(right.len());
        for j in start..=end {
            current[j] = (previous[j] + 1)
                .min(current[j - 1] + 1)
                .min(previous[j - 1] + usize::from(*left_char != right[j - 1]));
            if i > 0 && j > 1 && *left_char == right[j - 2] && left[i - 1] == right[j - 1] {
                current[j] = current[j].min(before_previous[j - 2] + 1);
            }
        }
        if current.iter().all(|distance| *distance > limit) {
            return None;
        }
        before_previous = previous;
        previous = current;
    }
    let distance = previous[right.len()];
    (distance <= limit).then_some(distance)
}

async fn review_name(
    db: &sqlx::PgPool,
    field: &str,
    name: &str,
) -> Result<NameReview, sqlx::Error> {
    let key = search_key(name);
    if key.is_empty() {
        return Ok(NameReview {
            exact: None,
            similar: vec![],
        });
    }
    // The field is a constant from check_pair, never request text.
    let exact = sqlx::query_scalar::<_, Option<String>>(&format!(
        "SELECT MIN({field}) FROM medication_name_pairs WHERE {field}_key = $1"
    ))
    .bind(&key)
    .fetch_one(db)
    .await?;
    let length = key.chars().count();
    if exact.is_some() || !(4..=100).contains(&length) {
        return Ok(NameReview {
            exact,
            similar: vec![],
        });
    }
    let limit = if length >= 8 { 2 } else { 1 };
    let candidates = sqlx::query_scalar::<_, String>(&format!(
        "SELECT MIN({field}) FROM medication_name_pairs
         WHERE char_length({field}_key) BETWEEN $1 AND $2
         GROUP BY {field}_key ORDER BY (left({field}_key, 2) = $3) DESC, {field}_key LIMIT 500"
    ))
    .bind((length - limit) as i32)
    .bind((length + limit) as i32)
    .bind(key.chars().take(2).collect::<String>())
    .fetch_all(db)
    .await?;
    let mut similar: Vec<_> = candidates
        .into_iter()
        .filter_map(|candidate| {
            spelling_distance(&key, &search_key(&candidate), limit)
                .map(|distance| (distance, candidate))
        })
        .collect();
    similar.sort();
    Ok(NameReview {
        exact,
        similar: similar.into_iter().take(5).map(|(_, name)| name).collect(),
    })
}

async fn check_pair(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(input): Query<PairInput>,
) -> Response {
    if let Err(response) = auth.require_any_role(&[Role::Ceo]) {
        return response;
    }
    let input = match normalize_pair(input) {
        Ok(input) => input,
        Err(response) => return response,
    };
    let result: Result<_, sqlx::Error> = async {
        let known_pair: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM medication_name_pairs WHERE handelsname_key = $1 AND wirkstoff_key = $2)"
        ).bind(search_key(&input.handelsname)).bind(search_key(&input.wirkstoff)).fetch_one(&state.db).await?;
        let handelsname = review_name(&state.db, "handelsname", &input.handelsname).await?;
        let wirkstoff = review_name(&state.db, "wirkstoff", &input.wirkstoff).await?;
        Ok(json!({ "known_pair": known_pair, "handelsname": handelsname, "wirkstoff": wirkstoff }))
    }.await;
    match result {
        Ok(result) => Json(result).into_response(),
        Err(error) => catalog_db_error(error),
    }
}

#[derive(Deserialize)]
struct PairUpdate {
    #[serde(flatten)]
    names: PairInput,
    version: i32,
}

fn catalog_error(status: StatusCode, code: &str) -> Response {
    (status, Json(json!({ "code": code, "message": code }))).into_response()
}

fn normalize_pair(input: PairInput) -> Result<PairInput, Response> {
    let names = PairInput {
        handelsname: clean_name(&input.handelsname),
        wirkstoff: clean_name(&input.wirkstoff),
    };
    if names.wirkstoff.is_empty()
        || [&names.handelsname, &names.wirkstoff]
            .iter()
            .any(|name| name.chars().count() > MAX_NAME_LENGTH)
    {
        return Err(catalog_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "medication_pair_invalid",
        ));
    }
    Ok(names)
}

fn catalog_db_error(error: sqlx::Error) -> Response {
    if error
        .as_database_error()
        .is_some_and(|error| error.is_unique_violation())
    {
        return catalog_error(StatusCode::CONFLICT, "medication_pair_exists");
    }
    tracing::error!(%error, "medication name catalog");
    catalog_error(
        StatusCode::INTERNAL_SERVER_ERROR,
        "medication_catalog_failed",
    )
}

async fn list_pairs(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<CatalogQuery>,
) -> Response {
    if let Err(response) = auth.require_any_role(&[Role::Ceo]) {
        return response;
    }
    if query.q.chars().count() > MAX_NAME_LENGTH {
        return catalog_error(StatusCode::UNPROCESSABLE_ENTITY, "medication_pair_invalid");
    }
    let page = query.page.unwrap_or(1).max(1);
    let page_size = query.page_size.unwrap_or(50).clamp(1, 100);
    let term = format!("%{}%", literal_like(&search_key(&query.q)));
    let total = match sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM medication_name_pairs
         WHERE handelsname_key LIKE $1 OR wirkstoff_key LIKE $1",
    )
    .bind(&term)
    .fetch_one(&state.db)
    .await
    {
        Ok(total) => total,
        Err(error) => return catalog_db_error(error),
    };
    match sqlx::query_as::<_, NamePair>(
        "SELECT id, handelsname, wirkstoff, version FROM medication_name_pairs
         WHERE handelsname_key LIKE $1 OR wirkstoff_key LIKE $1
         ORDER BY handelsname_key, wirkstoff_key, id LIMIT $2 OFFSET $3",
    )
    .bind(&term)
    .bind(i64::from(page_size))
    .bind(i64::from(page - 1) * i64::from(page_size))
    .fetch_all(&state.db)
    .await
    {
        Ok(items) => {
            Json(json!({ "items": items, "total": total, "page": page, "page_size": page_size }))
                .into_response()
        }
        Err(error) => catalog_db_error(error),
    }
}

async fn create_pair(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    audit: Option<Extension<AuditContext>>,
    Json(input): Json<PairInput>,
) -> Response {
    if let Err(response) = auth.require_any_role(&[Role::Ceo]) {
        return response;
    }
    let input = match normalize_pair(input) {
        Ok(input) => input,
        Err(response) => return response,
    };
    match sqlx::query_as::<_, NamePair>(
        "INSERT INTO medication_name_pairs (handelsname, wirkstoff) VALUES ($1, $2)
         RETURNING id, handelsname, wirkstoff, version",
    )
    .bind(&input.handelsname)
    .bind(&input.wirkstoff)
    .fetch_one(&state.db)
    .await
    {
        Ok(item) => {
            if let Some(Extension(audit)) = audit {
                audit.set_action("create_medication_name_pair");
                audit.set_entity("medication_name_pair", item.id);
                audit.set_new_value(json!(&item));
            }
            (StatusCode::CREATED, Json(item)).into_response()
        }
        Err(error) => catalog_db_error(error),
    }
}

async fn update_pair(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    audit: Option<Extension<AuditContext>>,
    Path(id): Path<Uuid>,
    Json(input): Json<PairUpdate>,
) -> Response {
    if let Err(response) = auth.require_any_role(&[Role::Ceo]) {
        return response;
    }
    let names = match normalize_pair(input.names) {
        Ok(input) => input,
        Err(response) => return response,
    };
    let mut transaction = match state.db.begin().await {
        Ok(transaction) => transaction,
        Err(error) => return catalog_db_error(error),
    };
    let previous = match sqlx::query_as::<_, NamePair>(
        "SELECT id, handelsname, wirkstoff, version FROM medication_name_pairs WHERE id = $1 FOR UPDATE",
    ).bind(id).fetch_optional(&mut *transaction).await {
        Ok(Some(item)) => item,
        Ok(None) => return catalog_error(StatusCode::NOT_FOUND, "medication_pair_not_found"),
        Err(error) => return catalog_db_error(error),
    };
    if previous.version != input.version {
        return catalog_error(StatusCode::CONFLICT, "medication_pair_changed");
    }
    let item = match sqlx::query_as::<_, NamePair>(
        "UPDATE medication_name_pairs SET handelsname = $2, wirkstoff = $3, version = version + 1
         WHERE id = $1 RETURNING id, handelsname, wirkstoff, version",
    )
    .bind(id)
    .bind(&names.handelsname)
    .bind(&names.wirkstoff)
    .fetch_one(&mut *transaction)
    .await
    {
        Ok(item) => item,
        Err(error) => return catalog_db_error(error),
    };
    if let Err(error) = transaction.commit().await {
        return catalog_db_error(error);
    }
    if let Some(Extension(audit)) = audit {
        audit.set_action("update_medication_name_pair");
        audit.set_entity("medication_name_pair", item.id);
        audit.set_old_value(json!(&previous));
        audit.set_new_value(json!(&item));
    }
    Json(item).into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum NameField {
    Handelsname,
    Wirkstoff,
}

#[derive(Deserialize)]
struct NameQuery {
    field: NameField,
    #[serde(default)]
    q: String,
    /// Exact value of the other field, when choosing a linked name.
    related: Option<String>,
}

fn clean_name(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn search_key(value: &str) -> String {
    clean_name(value).to_lowercase()
}

fn literal_like(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

/// Called inside the medication save transaction: failed/cancelled forms do not
/// teach the dictionary, and concurrent duplicate saves remain idempotent.
pub(crate) async fn remember_pair(
    connection: &mut PgConnection,
    handelsname: &str,
    wirkstoff: &str,
) -> Result<(), sqlx::Error> {
    let handelsname = clean_name(handelsname);
    let wirkstoff = clean_name(wirkstoff);
    if wirkstoff.is_empty()
        || [&handelsname, &wirkstoff]
            .iter()
            .any(|name| name.chars().count() > MAX_NAME_LENGTH)
    {
        return Ok(());
    }
    sqlx::query(
        "INSERT INTO medication_name_pairs (handelsname, wirkstoff)
         VALUES ($1, $2) ON CONFLICT DO NOTHING",
    )
    .bind(handelsname)
    .bind(wirkstoff)
    .execute(connection)
    .await?;
    Ok(())
}

async fn search_names(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<NameQuery>,
) -> Response {
    // Same access as the clinical medication editor.
    if let Err(response) = auth.require_any_role(&[Role::Ceo]) {
        return response;
    }
    if query.q.chars().count() > MAX_NAME_LENGTH
        || query
            .related
            .as_deref()
            .is_some_and(|name| name.chars().count() > MAX_NAME_LENGTH)
    {
        return (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(json!({"message": "Medication name is too long"})),
        )
            .into_response();
    }
    let (field, related_field) = match query.field {
        NameField::Handelsname => ("handelsname", "wirkstoff"),
        NameField::Wirkstoff => ("wirkstoff", "handelsname"),
    };
    let term = literal_like(&search_key(&query.q));
    let related = query
        .related
        .as_deref()
        .map(search_key)
        .filter(|name| !name.is_empty());
    // Column names come only from the enum above; all user text is bound.
    let statement = format!(
        "SELECT MIN({field}) AS name FROM medication_name_pairs
         WHERE {field}_key <> '' AND {field}_key LIKE $1
           AND ($2::text IS NULL OR {related_field}_key = $2)
         GROUP BY {field}_key
         ORDER BY ({field}_key LIKE $3) DESC, {field}_key
         LIMIT $4"
    );
    match sqlx::query_scalar::<_, String>(&statement)
        .bind(format!("%{term}%"))
        .bind(related)
        .bind(format!("{term}%"))
        .bind((SUGGESTION_LIMIT + 1) as i64)
        .fetch_all(&state.db)
        .await
    {
        Ok(mut items) => {
            let has_more = items.len() > SUGGESTION_LIMIT;
            items.truncate(SUGGESTION_LIMIT);
            Json(json!({ "items": items, "has_more": has_more })).into_response()
        }
        Err(error) => {
            tracing::error!(%error, "search saved medication names");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"message": "Failed to search medication names"})),
            )
                .into_response()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spelling_suggestions_are_bounded_and_handle_transpositions() {
        assert_eq!(spelling_distance("metoprolol", "metoprolol", 2), Some(0));
        assert_eq!(spelling_distance("metoprolo", "metoprolol", 2), Some(1));
        assert_eq!(spelling_distance("metohexla", "metohexal", 2), Some(1));
        assert_eq!(spelling_distance("метапролол", "метопролол", 2), Some(1));
        assert_eq!(spelling_distance("metoprolol", "metronidazol", 2), None);
        assert_eq!(spelling_distance("abc", "abcdef", 2), None);
        assert_eq!(spelling_distance("abc", "xyz", 1), None);
    }

    #[test]
    fn confirmation_only_applies_to_the_reviewed_name_pair() {
        let confirmation = PairInput {
            handelsname: "Brand Name".into(),
            wirkstoff: "Substance".into(),
        };
        assert!(confirmation.confirms(" BRAND  NAME ", "substance"));
        assert!(!confirmation.confirms("Brand Typo", "Substance"));
        assert!(!confirmation.confirms("Brand Name", "Other Substance"));
    }

    #[test]
    fn name_keys_ignore_case_and_extra_whitespace_but_preserve_combinations() {
        assert_eq!(search_key("  Тест\t ПЛЮС\n"), "тест плюс");
        assert_eq!(clean_name("A  +\u{a0}B"), "A + B");
        assert_ne!(search_key("A + B"), search_key("A"));
    }

    #[test]
    fn search_treats_wildcards_as_literal_name_characters() {
        assert_eq!(literal_like("5%_\\"), "5\\%\\_\\\\");
    }
}
