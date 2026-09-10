use axum::{
    Json, Router,
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, put},
};
use chrono::{NaiveDate, Utc};
use gmed_domain::role::Role;
use serde::Deserialize;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{auth::middleware::AuthUser, state::AppState};

#[path = "hotel_breakfast_terms.rs"]
mod breakfast_terms;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/stats/reports/hotels", get(workspace))
        .route("/stats/reports/hotels/directory", get(directory))
        .route(
            "/stats/reports/hotels/{id}/breakfast-terms",
            get(breakfast_terms::get).put(breakfast_terms::save),
        )
        .route(
            "/stats/reports/hotels/{source}/{id}/rooms",
            put(update_rooms),
        )
        .route(
            "/stats/reports/hotels/{source}/{id}/breakfast",
            put(update_breakfast),
        )
}

#[derive(Deserialize)]
struct Period {
    from: NaiveDate,
    to: NaiveDate,
}

fn allowed(auth: &AuthUser) -> Result<(), Response> {
    auth.require_any_role(&[
        Role::Ceo,
        Role::CeoAssistant,
        Role::Billing,
        Role::PatientManager,
        Role::Concierge,
    ])
}

fn error(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({ "error": message }))).into_response()
}

#[cfg(test)]
mod hotel_access_tests {
    use super::*;

    #[test]
    fn concierge_can_access_hotel_operations() {
        let mut auth = AuthUser {
            user_id: Uuid::nil(),
            role: Role::Concierge,
            family_id: Uuid::nil(),
            access_token_jti: Uuid::nil(),
            access_token_expires_at: Utc::now(),
        };
        assert!(allowed(&auth).is_ok());
        for role in [Role::Patient, Role::Sales, Role::Interpreter] {
            auth.role = role;
            assert_eq!(allowed(&auth).unwrap_err().status(), StatusCode::FORBIDDEN);
        }
    }
}

async fn directory(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> Response {
    if let Err(response) = allowed(&auth) {
        return response;
    }
    let result = sqlx::query_scalar::<_, Value>(include_str!("hotel_directory.sql"))
        .fetch_all(&state.db)
        .await;
    match result {
        Ok(rows) => Json(rows).into_response(),
        Err(cause) => {
            tracing::error!(error = %cause, "load hotel directory");
            error(StatusCode::INTERNAL_SERVER_ERROR, "Failed to load hotels")
        }
    }
}

async fn workspace(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(period): Query<Period>,
) -> Response {
    if let Err(response) = allowed(&auth) {
        return response;
    }
    if period.to < period.from || (period.to - period.from).num_days() > 1096 {
        return error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Choose a valid period of at most three years",
        );
    }
    let result = sqlx::query_scalar::<_, Value>(include_str!("hotel_statistics.sql"))
        .bind(period.from)
        .bind(period.to)
        .bind(auth.role != Role::PatientManager)
        .bind(auth.user_id)
        .fetch_all(&state.db)
        .await;
    match result {
        Ok(rows) => Json(json!({ "rows": rows, "from": period.from.to_string(), "to": period.to.to_string(), "timezone": "Europe/Berlin", "generated_at": Utc::now().to_rfc3339() })).into_response(),
        Err(cause) => {
            tracing::error!(error = %cause, "load hotel statistics");
            error(StatusCode::INTERNAL_SERVER_ERROR, "Failed to load hotel statistics")
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RoomCount {
    room_count: Option<i32>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Breakfast {
    breakfast_mode: String,
    breakfast_count: Option<i32>,
    breakfast_total: Option<String>,
    breakfast_currency: Option<String>,
    breakfast_payer: String,
    breakfast_notes: Option<String>,
}

impl Breakfast {
    fn valid(&self) -> bool {
        let paid = matches!(self.breakfast_mode.as_str(), "hotel_extra" | "self");
        matches!(
            self.breakfast_mode.as_str(),
            "unknown" | "included" | "hotel_extra" | "self" | "none"
        ) && matches!(
            self.breakfast_payer.as_str(),
            "unknown" | "patient" | "company" | "split"
        ) && self
            .breakfast_count
            .is_none_or(|count| (1..=100000).contains(&count))
            && (!matches!(self.breakfast_mode.as_str(), "unknown" | "none")
                || self.breakfast_count.is_none())
            && (paid || (self.breakfast_total.is_none() && self.breakfast_payer == "unknown"))
            && (self.breakfast_total.is_some() == self.breakfast_currency.is_some())
            && self.breakfast_currency.as_ref().is_none_or(|currency| {
                currency.len() == 3 && currency.bytes().all(|ch| ch.is_ascii_uppercase())
            })
            && self
                .breakfast_total
                .as_ref()
                .is_none_or(|amount| valid_breakfast_amount(amount))
            && self
                .breakfast_notes
                .as_ref()
                .is_none_or(|notes| notes.chars().count() <= 2000)
    }
}

fn valid_breakfast_amount(amount: &str) -> bool {
    let (whole, fraction) = amount.split_once('.').unwrap_or((amount, ""));
    !whole.is_empty()
        && whole.len() <= 10
        && whole.bytes().all(|ch| ch.is_ascii_digit())
        && fraction.len() <= 2
        && fraction.bytes().all(|ch| ch.is_ascii_digit())
        && (!amount.contains('.') || !fraction.is_empty())
}

async fn update_breakfast(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((source, id)): Path<(String, Uuid)>,
    Json(body): Json<Breakfast>,
) -> Response {
    if let Err(response) = allowed(&auth) {
        return response;
    }
    if auth.role == Role::CeoAssistant {
        return error(StatusCode::FORBIDDEN, "Read-only access");
    }
    if !matches!(source.as_str(), "service" | "task") || !body.valid() {
        return error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid breakfast details",
        );
    }
    // Only a fixed identifier is substituted; all request values are bound parameters.
    let key = if source == "service" {
        "concierge_service_id"
    } else {
        "task_id"
    };
    let sql = include_str!("hotel_breakfast_update.sql").replace("__SOURCE_KEY__", key);
    let saved = sqlx::query_scalar::<_, Uuid>(&sql)
        .bind(&source)
        .bind(id)
        .bind(&body.breakfast_mode)
        .bind(body.breakfast_count)
        .bind(&body.breakfast_total)
        .bind(&body.breakfast_currency)
        .bind(&body.breakfast_payer)
        .bind(&body.breakfast_notes)
        .bind(auth.user_id)
        .bind(auth.role != Role::PatientManager)
        .fetch_optional(&state.db)
        .await;
    match saved {
        Ok(Some(_)) => Json(json!({ "saved": true })).into_response(),
        Ok(None) => error(
            StatusCode::CONFLICT,
            "Booking unavailable or currency changed; refresh the report",
        ),
        Err(cause) => {
            tracing::error!(error = %cause, "update hotel breakfast details");
            error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to save breakfast details",
            )
        }
    }
}

#[cfg(test)]
mod breakfast_tests {
    use super::*;

    #[test]
    fn amounts_are_exact_non_negative_cents() {
        for amount in ["0", "0.00", "12.3", "9999999999.99"] {
            assert!(valid_breakfast_amount(amount));
        }
        for amount in [
            "",
            "1.",
            "-1",
            "NaN",
            "1e3",
            "0.001",
            "1.2.3",
            "10000000000",
        ] {
            assert!(!valid_breakfast_amount(amount));
        }
    }

    #[test]
    fn included_breakfast_cannot_add_an_extra_cost() {
        let mut value = Breakfast {
            breakfast_mode: "included".into(),
            breakfast_count: Some(10),
            breakfast_total: None,
            breakfast_currency: None,
            breakfast_payer: "unknown".into(),
            breakfast_notes: None,
        };
        assert!(value.valid());
        value.breakfast_total = Some("50.00".into());
        value.breakfast_currency = Some("EUR".into());
        assert!(!value.valid());
        value.breakfast_mode = "hotel_extra".into();
        assert!(value.valid());
        value.breakfast_currency = None;
        assert!(!value.valid());
    }
}

async fn update_rooms(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((source, id)): Path<(String, Uuid)>,
    Json(body): Json<RoomCount>,
) -> Response {
    if let Err(response) = allowed(&auth) {
        return response;
    }
    if auth.role == Role::CeoAssistant {
        return error(StatusCode::FORBIDDEN, "Read-only access");
    }
    if !matches!(source.as_str(), "service" | "task")
        || body
            .room_count
            .is_some_and(|count| !(1..=1000).contains(&count))
    {
        return error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Room count must be between 1 and 1000, or null",
        );
    }
    // Scope and source identity are checked in the mutation itself, including task-only bookings.
    let result = sqlx::query_scalar::<_, Uuid>(
        r#"WITH booking AS (
            SELECT cs.id, CASE WHEN linked.service_kind IS NULL THEN cs.patient_id ELSE linked.patient_id END AS patient_id
            FROM concierge_services cs
            LEFT JOIN LATERAL (
                SELECT task.* FROM tasks task WHERE task.concierge_service_id = cs.id
                ORDER BY (task.service_kind IS NOT NULL) DESC, (task.deleted_at IS NULL) DESC,
                         (task.task_scope = 'concierge_operational') DESC, task.created_at, task.id LIMIT 1
            ) linked ON true
            WHERE $1 = 'service' AND cs.id = $2 AND COALESCE(linked.service_kind, cs.service_kind) = 'hotel'
              AND linked.deleted_at IS NULL
              AND (CASE WHEN linked.service_kind IS NULL THEN cs.patient_id ELSE linked.patient_id END) IS NOT NULL
              AND (linked.id IS NOT NULL OR NOT EXISTS (SELECT 1 FROM tasks task WHERE task.concierge_service_id = cs.id))
            UNION ALL
            SELECT id, patient_id FROM tasks WHERE $1 = 'task' AND id = $2 AND service_kind = 'hotel'
              AND concierge_service_id IS NULL AND deleted_at IS NULL AND patient_id IS NOT NULL
        )
        INSERT INTO hotel_stay_statistics_details (concierge_service_id, task_id, room_count, updated_by)
        SELECT CASE WHEN $1 = 'service' THEN id END, CASE WHEN $1 = 'task' THEN id END, $3, $4
        FROM booking WHERE $5 OR EXISTS (SELECT 1 FROM patient_assignments WHERE patient_id = booking.patient_id AND user_id = $4 AND revoked_at IS NULL)
        ON CONFLICT (concierge_service_id) DO UPDATE SET room_count = EXCLUDED.room_count, updated_by = EXCLUDED.updated_by, updated_at = now()
        RETURNING id"#,
    );
    // Both source keys have independent unique constraints.
    let task_sql = r#"INSERT INTO hotel_stay_statistics_details (task_id, room_count, updated_by)
        SELECT task.id, $2, $3 FROM tasks task
        WHERE task.id = $1 AND task.service_kind = 'hotel' AND task.concierge_service_id IS NULL
          AND task.deleted_at IS NULL AND task.patient_id IS NOT NULL
          AND ($4 OR EXISTS (SELECT 1 FROM patient_assignments WHERE patient_id = task.patient_id AND user_id = $3 AND revoked_at IS NULL))
        ON CONFLICT (task_id) DO UPDATE SET room_count = EXCLUDED.room_count, updated_by = EXCLUDED.updated_by, updated_at = now()
        RETURNING id"#;
    let saved = if source == "task" {
        sqlx::query_scalar::<_, Uuid>(task_sql)
            .bind(id)
            .bind(body.room_count)
            .bind(auth.user_id)
            .bind(auth.role != Role::PatientManager)
            .fetch_optional(&state.db)
            .await
    } else {
        result
            .bind(&source)
            .bind(id)
            .bind(body.room_count)
            .bind(auth.user_id)
            .bind(auth.role != Role::PatientManager)
            .fetch_optional(&state.db)
            .await
    };
    match saved {
        Ok(Some(_)) => Json(json!({ "room_count": body.room_count })).into_response(),
        Ok(None) => error(StatusCode::NOT_FOUND, "Hotel booking not found"),
        Err(cause) => {
            tracing::error!(error = %cause, "update hotel room count");
            error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to save room count",
            )
        }
    }
}
