use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use uuid::Uuid;

#[derive(Default, Deserialize)]
pub(crate) struct PatientClinicalSaveQuery {
    pub mode: Option<String>,
    pub expected_revision: Option<i64>,
    pub operation_id: Option<Uuid>,
    pub remove_ids: Option<String>,
}
impl PatientClinicalSaveQuery {
    pub fn merge_only(&self) -> bool {
        self.mode.as_deref() == Some("merge")
    }
}
fn error(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({"message": message}))).into_response()
}
fn database_error(_: sqlx::Error) -> Response {
    error(
        StatusCode::INTERNAL_SERVER_ERROR,
        "Failed to protect clinical edit",
    )
}

/// Patient lock, optimistic revision, and replay record share the clinical transaction.
/// Returning false acknowledges a committed replay without repeating any mutation.
pub(crate) async fn guard_clinical_edit<T: serde::Serialize>(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    query: &PatientClinicalSaveQuery,
    patient_id: Uuid,
    actor_id: Uuid,
    section: &str,
    payload: &T,
) -> Result<bool, Response> {
    let canonical = serde_json::to_vec(
        &json!({"payload":payload,"mode":query.mode,"remove_ids":query.remove_ids}),
    )
    .map_err(|_| {
        error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to identify clinical edit",
        )
    })?;
    let payload_hash = hex::encode(Sha256::digest(canonical));
    let revision: i64 =
        sqlx::query_scalar("SELECT clinical_revision FROM patients WHERE id=$1 FOR UPDATE")
            .bind(patient_id)
            .fetch_one(&mut **tx)
            .await
            .map_err(database_error)?;
    if let Some(operation) = query.operation_id {
        let existing: Option<(Uuid, String, i64, String)> = sqlx::query_as(
            "SELECT actor_id,section,expected_revision,payload_hash FROM patient_clinical_operations WHERE patient_id=$1 AND operation_id=$2")
            .bind(patient_id).bind(operation).fetch_optional(&mut **tx).await.map_err(database_error)?;
        if let Some(existing) = existing {
            if existing.0 != actor_id
                || existing.1 != section
                || Some(existing.2) != query.expected_revision
                || existing.3 != payload_hash
            {
                return Err(error(
                    StatusCode::CONFLICT,
                    "Clinical operation key has already been used",
                ));
            }
            return Ok(false);
        }
    }
    if query
        .expected_revision
        .is_some_and(|expected| expected != revision)
    {
        return Err(error(
            StatusCode::CONFLICT,
            "Clinical data changed. Reload the medical record before saving your changes.",
        ));
    }
    if query.operation_id.is_some() && query.expected_revision.is_none() {
        return Err(error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Clinical revision is required",
        ));
    }
    if let Some(operation) = query.operation_id {
        sqlx::query("INSERT INTO patient_clinical_operations(patient_id,operation_id,actor_id,section,expected_revision,payload_hash) VALUES($1,$2,$3,$4,$5,$6)")
            .bind(patient_id).bind(operation).bind(actor_id).bind(section).bind(revision).bind(payload_hash)
            .execute(&mut **tx).await.map_err(database_error)?;
    }
    Ok(true)
}

/// Explicit removals are covered by the caller's before/after version history.
pub(crate) async fn remove_clinical_entries(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    query: &PatientClinicalSaveQuery,
    patient_id: Uuid,
    section: &str,
) -> Result<(), Response> {
    let Some(raw) = query
        .remove_ids
        .as_deref()
        .filter(|value| !value.is_empty())
    else {
        return Ok(());
    };
    if query.expected_revision.is_none() || query.operation_id.is_none() || !query.merge_only() {
        return Err(error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Explicit clinical removals require a revision and operation key",
        ));
    }
    let ids = raw
        .split(',')
        .map(Uuid::parse_str)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| {
            error(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Invalid clinical record id",
            )
        })?;
    let statement = match section {
        "diagnoses" => "DELETE FROM patient_diagnoses WHERE patient_id=$1 AND id=ANY($2)",
        "medications" => {
            "UPDATE patient_medications SET superseded_at=now() WHERE patient_id=$1 AND id=ANY($2) AND superseded_at IS NULL"
        }
        "allergie" => {
            "DELETE FROM patient_clinical_warnings WHERE patient_id=$1 AND id=ANY($2) AND kind='allergie'"
        }
        "cave" => {
            "DELETE FROM patient_clinical_warnings WHERE patient_id=$1 AND id=ANY($2) AND kind='cave'"
        }
        _ => {
            return Err(error(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Unsupported clinical removal",
            ));
        }
    };
    sqlx::query(statement)
        .bind(patient_id)
        .bind(ids)
        .execute(&mut **tx)
        .await
        .map_err(database_error)?;
    Ok(())
}
