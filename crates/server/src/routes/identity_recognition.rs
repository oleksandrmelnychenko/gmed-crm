//! `POST /documents/{id}/identity-recognition`: reads the machine readable
//! zone of an uploaded identity scan (passport, ID card, residence permit)
//! and answers with the values as a proposal for the form.
//!
//! * Access is the file's own: whoever may take a copy of the scan
//!   (`GET /documents/{id}/download`, the same checks) may have it read.
//!   Medical files are refused.
//! * The lead's cabinet has its own route,
//!   `POST /me/lead-requests/{lead_id}/documents/{document_id}/identity-recognition`:
//!   whoever fills the request (the lead, a parent, staff for the client)
//!   has a copy of the identity document of the lead or of a representative
//!   read, never another file.
//! * Nothing is stored and nothing is written to the log: staff see the
//!   values, confirm or correct them, and the form's own save stores them.
//! * The reading is recorded like a download (who had which scan read, and
//!   whether the check digits held), without any value of the document.

use axum::{
    Json, Router,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post,
};
use serde_json::{Value, json};
use sqlx::Row;
use uuid::Uuid;

use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::routes::documents::{StaffDocumentCopy, load_staff_document_copy};
use crate::routes::lead_portal_intake as intake;
use crate::services::identity_recognition::{self, RecognitionError};
use crate::services::mrz::MrzData;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/documents/{id}/identity-recognition",
            post(recognize_identity_document),
        )
        .route(
            "/me/lead-requests/{lead_id}/documents/{document_id}/identity-recognition",
            post(recognize_my_identity_document),
        )
}

fn error(status: StatusCode, code: &str, message: &str) -> Response {
    (
        status,
        Json(json!({ "error": code, "code": code, "message": message })),
    )
        .into_response()
}

pub(crate) fn recognition_error_response(error_kind: RecognitionError) -> Response {
    match error_kind {
        RecognitionError::UnsupportedFile => error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "unsupported_file",
            "Only PDF and image files can be read",
        ),
        RecognitionError::Unavailable => error(
            StatusCode::SERVICE_UNAVAILABLE,
            "recognition_unavailable",
            "Document recognition is not available on this server",
        ),
        RecognitionError::Failed => error(
            StatusCode::BAD_GATEWAY,
            "recognition_failed",
            "The document could not be read",
        ),
    }
}

/// `verified` when every check digit holds, `unverified` when a zone was
/// read but a digit fails, `not_found` without a zone.
pub(crate) fn recognition_status(found: Option<&MrzData>) -> &'static str {
    match found {
        Some(data) if data.checks.all() => "verified",
        Some(_) => "unverified",
        None => "not_found",
    }
}

/// The answer for the form: the document's fields under the form's names,
/// the holder's data apart. A value the zone leaves open is `null`.
pub(crate) fn recognition_json(found: Option<&MrzData>) -> Value {
    let status = recognition_status(found);
    let Some(data) = found else {
        return json!({ "status": status });
    };
    json!({
        "status": status,
        "format": data.format,
        "checks": data.checks,
        "names_truncated": data.names_truncated,
        "document": {
            "id_document_type": data.document_type,
            "id_document_number": data.document_number,
            "id_issuing_country": data.issuing_country,
            "id_valid_until": data.valid_until,
        },
        "holder": {
            "last_name": data.surname,
            "first_name": data.given_names,
            "date_of_birth": data.birth_date,
            "legal_sex": data.sex,
            "citizenship": data.nationality,
        },
    })
}

async fn recognize_identity_document(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Response {
    let StaffDocumentCopy { row, data, .. } =
        match load_staff_document_copy(&state, &auth, id).await {
            Ok(copy) => copy,
            Err(response) => return response,
        };
    if row.try_get::<bool, _>("is_medical").unwrap_or(false) {
        return error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "not_an_identity_document",
            "Only identity documents can be read",
        );
    }

    let found = match identity_recognition::recognize(&data, crate::app_time::today()).await {
        Ok(found) => found,
        Err(error_kind) => {
            tracing::warn!(document_id = %id, reason = ?error_kind, "identity recognition failed");
            return recognition_error_response(error_kind);
        }
    };

    // Recorded before the values go out, like a download: no value of the
    // document, only that it was read and whether the check digits held.
    let event = audit::domain_event(
        "identity_document_recognized",
        Some(auth.user_id),
        "document",
        Some(id),
        json!({
            "patient_id": row.try_get::<Option<Uuid>, _>("patient_id").unwrap_or_default(),
            "lead_id": row.try_get::<Option<Uuid>, _>("lead_id").unwrap_or_default()
                .or(row.try_get::<Option<Uuid>, _>("upload_lead_id").unwrap_or_default()),
            "outcome": recognition_status(found.as_ref()),
        }),
    );
    let recorded = async {
        let mut conn = state.db.acquire().await?;
        audit::write_in_transaction(&mut conn, &event).await
    }
    .await;
    if let Err(error_value) = recorded {
        tracing::error!(error = %error_value, document_id = %id, "record identity recognition");
        return error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "Failed to record the recognition",
        );
    }

    Json(recognition_json(found.as_ref())).into_response()
}

/// The cabinet: a copy of the identity document of the lead or of a person
/// who acts for the lead, read for whoever fills the request. The file is
/// found only among the request's identity copies, so no other document is
/// ever read this way.
async fn recognize_my_identity_document(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((lead_id, document_id)): Path<(Uuid, Uuid)>,
) -> Response {
    if let Err(response) = intake::require_cabinet_editor(&auth) {
        return response;
    }
    let not_found = || error(StatusCode::NOT_FOUND, "not_found", "Document not found");
    match intake::my_lead_access(&state, lead_id, auth.user_id).await {
        Ok(Some(_)) => {}
        Ok(None) => return not_found(),
        Err(error_value) => return intake::internal(error_value, "check request access"),
    }
    let upload = match sqlx::query(
        r#"SELECT d.storage_key, d.mime_type
           FROM lead_portal_uploads u
           JOIN documents d ON d.id = u.document_id
           WHERE u.document_id = $1
             AND u.lead_id = $2
             AND u.kind IN ('identity', 'representative_identity')
             AND u.withdrawn_at IS NULL
             AND d.file_deleted_at IS NULL"#,
    )
    .bind(document_id)
    .bind(lead_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(found) => found,
        Err(error_value) => return intake::internal(error_value, "load identity upload"),
    };
    let Some(storage_key) = upload.as_ref().and_then(|row| {
        row.try_get::<Option<String>, _>("storage_key")
            .ok()
            .flatten()
    }) else {
        return not_found();
    };
    let mime_type = upload
        .as_ref()
        .and_then(|row| row.try_get::<Option<String>, _>("mime_type").ok().flatten());
    let Ok(data) = crate::routes::documents::read_document_storage_bytes(
        document_id,
        &storage_key,
        mime_type.as_deref(),
        None,
        None,
    )
    .await
    else {
        return not_found();
    };

    let found = match identity_recognition::recognize(&data, crate::app_time::today()).await {
        Ok(found) => found,
        Err(error_kind) => {
            tracing::warn!(document_id = %document_id, reason = ?error_kind, "cabinet identity recognition failed");
            return recognition_error_response(error_kind);
        }
    };
    let event = audit::domain_event(
        "identity_document_recognized",
        Some(auth.user_id),
        "document",
        Some(document_id),
        json!({
            "lead_id": lead_id,
            "outcome": recognition_status(found.as_ref()),
        }),
    );
    let recorded = async {
        let mut conn = state.db.acquire().await?;
        audit::write_in_transaction(&mut conn, &event).await
    }
    .await;
    if let Err(error_value) = recorded {
        return intake::internal(error_value, "record cabinet identity recognition");
    }
    Json(recognition_json(found.as_ref())).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::mrz;

    #[test]
    fn the_answer_names_the_forms_fields_and_keeps_the_holder_apart() {
        let today = chrono::NaiveDate::from_ymd_opt(2026, 11, 10).unwrap();
        // The specimen of ICAO Doc 9303 part 4 (state "Utopia").
        let zone = "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\nL898902C36UTO7408122F1204159ZE184226B<<<<<10";
        let found = mrz::read(zone, today);
        let answer = recognition_json(found.as_ref());
        assert_eq!(answer["status"], "verified");
        assert_eq!(answer["format"], "TD3");
        assert_eq!(answer["document"]["id_document_type"], "passport");
        assert_eq!(answer["document"]["id_document_number"], "L898902C3");
        assert_eq!(answer["document"]["id_valid_until"], "2012-04-15");
        // "Utopia" is no state: the country stays empty.
        assert_eq!(answer["document"]["id_issuing_country"], Value::Null);
        assert_eq!(answer["holder"]["last_name"], "Eriksson");
        assert_eq!(answer["holder"]["first_name"], "Anna Maria");
        assert_eq!(answer["holder"]["date_of_birth"], "1974-08-12");
        assert_eq!(answer["holder"]["legal_sex"], "female");
        assert_eq!(answer["checks"]["composite"], true);

        let misread = zone.replace("1204159", "1304159");
        let answer = recognition_json(mrz::read(&misread, today).as_ref());
        assert_eq!(answer["status"], "unverified");
        assert_eq!(answer["checks"]["valid_until"], false);

        assert_eq!(recognition_json(None), json!({ "status": "not_found" }));
    }
}
