use axum::{
    Json, Router,
    extract::{Extension, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
};
use gmed_domain::role::Role;
use serde::Deserialize;
use serde_json::json;
use sqlx::PgConnection;

use crate::{auth::middleware::AuthUser, state::AppState};

const MAX_NAME_LENGTH: usize = 500;
const SUGGESTION_LIMIT: usize = 50;

pub fn router() -> Router<AppState> {
    Router::new().route("/medication-names", get(search_names))
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
