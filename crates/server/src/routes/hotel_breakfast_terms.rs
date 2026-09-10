use crate::{auth::middleware::AuthUser, state::AppState};
use axum::{
    Json,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use chrono::Utc;
use gmed_domain::role::Role;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

#[derive(Deserialize, Serialize)]
pub(super) struct Terms {
    mode: String,
    price_per_person: Option<String>,
    currency: Option<String>,
    notes: Option<String>,
}

impl Terms {
    fn valid(&self) -> bool {
        matches!(
            self.mode.as_str(),
            "unknown" | "included" | "extra" | "unavailable"
        ) && (self.mode == "extra" || (self.price_per_person.is_none() && self.currency.is_none()))
            && (self.price_per_person.is_some() == self.currency.is_some())
            && self
                .price_per_person
                .as_ref()
                .is_none_or(|price| super::valid_breakfast_amount(price))
            && self.currency.as_ref().is_none_or(|currency| {
                currency.len() == 3 && currency.bytes().all(|ch| ch.is_ascii_uppercase())
            })
            && self
                .notes
                .as_ref()
                .is_none_or(|notes| notes.chars().count() <= 2000)
    }
}

pub(super) async fn get(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Response {
    if let Err(response) = super::allowed(&auth) {
        return response;
    }
    let result = sqlx::query_scalar::<_, Value>(
        r#"SELECT COALESCE(provider.taxonomy_attributes->'hotel_breakfast_terms', '{}'::jsonb)
        FROM providers provider WHERE provider.id = $1 AND provider.provider_type = 'non_medical'
        AND EXISTS (SELECT 1 FROM provider_taxonomy_assignments assignment
            JOIN provider_taxonomy_nodes taxonomy ON taxonomy.id = assignment.taxonomy_node_id
            WHERE assignment.provider_id = provider.id AND taxonomy.code = 'nonmedical_hotels')"#,
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await;
    respond(result)
}

pub(super) async fn save(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Json(body): Json<Terms>,
) -> Response {
    if let Err(response) =
        auth.require_any_role(&[Role::Ceo, Role::PatientManager, Role::Concierge])
    {
        return response;
    }
    if !body.valid() {
        return super::error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid hotel breakfast terms",
        );
    }
    let value = json!({ "mode": body.mode, "price_per_person": body.price_per_person, "currency": body.currency,
        "notes": body.notes.map(|notes| notes.trim().to_owned()).filter(|notes| !notes.is_empty()), "updated_at": Utc::now(), "updated_by": auth.user_id });
    let result = sqlx::query_scalar::<_, Value>(include_str!("hotel_breakfast_terms_update.sql"))
        .bind(id)
        .bind(value)
        .fetch_optional(&state.db)
        .await;
    respond(result)
}

fn respond(result: Result<Option<Value>, sqlx::Error>) -> Response {
    match result {
        Ok(Some(value)) => Json(value).into_response(),
        Ok(None) => super::error(StatusCode::NOT_FOUND, "Hotel not found"),
        Err(error) => {
            tracing::error!(error = %error, "hotel breakfast terms");
            super::error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load or save hotel breakfast terms",
            )
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn hotel_terms_keep_price_optional_and_never_attach_extra_cost_to_included_breakfast() {
        let mut terms = Terms {
            mode: "extra".into(),
            price_per_person: None,
            currency: None,
            notes: None,
        };
        assert!(terms.valid());
        terms.price_per_person = Some("12.50".into());
        assert!(!terms.valid());
        terms.currency = Some("EUR".into());
        assert!(terms.valid());
        terms.mode = "included".into();
        assert!(!terms.valid());
        terms.mode = "extra".into();
        terms.price_per_person = Some("-1.00".into());
        assert!(!terms.valid());
        terms.price_per_person = Some("0.001".into());
        assert!(!terms.valid());
        terms.price_per_person = None;
        terms.currency = None;
        terms.mode = "unavailable".into();
        assert!(terms.valid());
    }
}
