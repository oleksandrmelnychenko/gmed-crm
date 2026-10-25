//! The basic identity of a lead's parents and representatives.
//!
//! A trusted contact may explicitly point to an existing patient. The contact
//! and the lead-specific representative answers stay authoritative; the linked
//! patient's current basic identity only fills missing values. No lookup by
//! name or e-mail, medical data, consents or documents is part of this loader.
//! It can use an existing transaction and batches all linked-patient reads.

use std::collections::{HashMap, HashSet};

use chrono::NaiveDate;
use serde_json::{Value, json};
use sqlx::PgConnection;
use uuid::Uuid;

/// An effective identity, without changing the stored contact or patient.
#[derive(Clone, Debug)]
pub struct CanonicalGuardianIdentity {
    /// Old contacts without a UUID remain screenable under their position.
    pub contact_id: Option<Uuid>,
    pub related_patient_id: Option<Uuid>,
    pub position: usize,
    pub name: String,
    pub citizenships: Vec<String>,
    pub residences: Vec<String>,
    pub role: String,
    /// Safe contact projection, using the existing trusted-contact keys.
    pub contact: Value,
    /// Safe representative projection, using the existing identity keys.
    pub extras: Value,
}

fn text(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

fn uuid(value: &Value, key: &str) -> Option<Uuid> {
    text(value, key).and_then(|value| Uuid::parse_str(&value).ok())
}

fn codes(value: &Value, key: &str) -> Vec<String> {
    let values = match value.get(key) {
        Some(Value::Array(items)) => items.iter().filter_map(Value::as_str).collect(),
        Some(Value::String(value)) => vec![value.as_str()],
        _ => Vec::new(),
    };
    crate::sanctions::normalize::country_codes(values)
}

/// An ISO 3166-1 alpha-2 code for a stored country: a code as it is, or a
/// country name a patient record holds as free text ("Ukraine",
/// "Deutschland"); `None` for anything else.
pub(crate) fn iso_country(value: &str) -> Option<String> {
    crate::sanctions::normalize::country_code(value)
        .filter(|code| crate::services::citizenships::is_country_code(code))
}

/// The countries of a representative are ISO codes wherever they are read
/// (the cabinet's country select, the invoice recipient, the declaration). A
/// linked patient's free-text address country (DEV 2026-10-21: "Ukraine"
/// broke the invoice recipient's `country` check) becomes its code; a value
/// that names no known country is left out.
fn normalize_countries(extras: &mut Value) {
    for key in ["country", "birth_country", "id_issuing_country"] {
        let Some(value) = extras.get(key).and_then(Value::as_str) else {
            continue;
        };
        let code = iso_country(value);
        extras[key] = json!(code);
    }
}

fn fill_text(target: &mut Value, key: &str, fallback: Option<String>) {
    if text(target, key).is_none()
        && let Some(value) = fallback
    {
        target[key] = json!(value);
    }
}

const CONTACT_KEYS: [&str; 12] = [
    "id",
    "related_patient_id",
    "name",
    "email",
    "phone",
    "relation",
    "birth_date",
    "address",
    "country",
    "residence_country",
    "citizenships",
    "date_of_birth",
];

const EXTRA_KEYS: [&str; 21] = [
    "lead_id",
    "contact_id",
    "role",
    "contact_origin",
    "first_name",
    "last_name",
    "birth_place",
    "birth_country",
    "citizenships",
    "street",
    "zip",
    "city",
    "country",
    "id_document_type",
    "id_document_number",
    "id_issuing_authority",
    "id_issuing_country",
    "id_issued_on",
    "id_valid_until",
    "id_document_unreadable",
    "id_document_expires_before_end",
];

fn project(value: &Value, keys: &[&str]) -> Value {
    let mut projection = json!({});
    for key in keys {
        if let Some(value) = value.get(*key) {
            projection[*key] = value.clone();
        }
    }
    projection
}

fn identity(
    lead_id: Uuid,
    position: usize,
    entry: &Value,
    row: Option<&Value>,
    patient: Option<&Value>,
) -> CanonicalGuardianIdentity {
    let mut contact = project(entry, &CONTACT_KEYS);
    let mut extras = project(row.unwrap_or(&Value::Null), &EXTRA_KEYS);
    let contact_id = uuid(entry, "id");
    let related_patient_id = uuid(entry, "related_patient_id");
    let role = text(&extras, "role").unwrap_or_default();
    extras["lead_id"] = json!(lead_id);
    extras["contact_id"] = json!(contact_id);

    if let Some(patient) = patient {
        if text(&contact, "name").is_none() {
            fill_text(&mut extras, "first_name", text(patient, "first_name"));
            fill_text(&mut extras, "last_name", text(patient, "last_name"));
        }
        let first = text(&extras, "first_name");
        let last = text(&extras, "last_name");
        let local_name = [first.clone(), last.clone()]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>()
            .join(" ");
        let patient_name = [text(patient, "first_name"), text(patient, "last_name")]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>()
            .join(" ");
        fill_text(
            &mut contact,
            "name",
            Some(if local_name.is_empty() {
                patient_name
            } else {
                local_name
            }),
        );
        let name = text(&contact, "name").unwrap_or_default();
        let (given, surname) = crate::routes::lead_representatives::name_parts(
            &name,
            first
                .as_deref()
                .or_else(|| patient.get("first_name").and_then(Value::as_str)),
            last.as_deref()
                .or_else(|| patient.get("last_name").and_then(Value::as_str)),
        );
        fill_text(&mut extras, "first_name", Some(given));
        fill_text(&mut extras, "last_name", Some(surname));
        for key in ["birth_date", "email", "phone"] {
            fill_text(&mut contact, key, text(patient, key));
        }
        // Document data describe one document. Missing fields of a different
        // locally stated document cannot be filled from the linked passport.
        let same_document = ["id_document_number", "id_document_type"]
            .into_iter()
            .all(|key| text(&extras, key).is_none_or(|value| Some(value) == text(patient, key)));
        for key in EXTRA_KEYS.into_iter().skip(6) {
            if key != "citizenships" && (!key.starts_with("id_") || same_document) {
                fill_text(&mut extras, key, text(patient, key));
            }
        }
        // An explicit country/citizenship on this lead wins over the linked
        // patient's countries. Do not union conflicting canonical values.
        let local_citizenships = codes(&extras, "citizenships")
            .into_iter()
            .chain(codes(&contact, "citizenships"))
            .collect::<Vec<_>>();
        if local_citizenships.is_empty() {
            extras["citizenships"] = json!(codes(patient, "citizenships"));
        }
        if text(&contact, "country").is_none()
            && text(&contact, "residence_country").is_none()
            && row.and_then(|row| text(row, "country")).is_none()
        {
            fill_text(&mut contact, "country", text(patient, "country"));
            fill_text(
                &mut contact,
                "residence_country",
                text(patient, "residence_country"),
            );
        } else if let Some(country) = row.and_then(|row| text(row, "country")) {
            extras["country"] = json!(country);
        } else {
            // The contact country is authoritative; a canonical address
            // country must not create a second conflicting country.
            extras["country"] =
                json!(text(&contact, "country").or_else(|| text(&contact, "residence_country")));
        }
    }

    normalize_countries(&mut extras);
    if codes(&extras, "citizenships").is_empty() {
        let contact_citizenships = codes(&contact, "citizenships");
        if !contact_citizenships.is_empty() {
            extras["citizenships"] = json!(contact_citizenships);
        }
    }
    fill_text(
        &mut extras,
        "country",
        codes(&contact, "country")
            .into_iter()
            .chain(codes(&contact, "residence_country"))
            .next(),
    );

    let citizenships = crate::sanctions::normalize::country_codes(
        codes(&contact, "citizenships")
            .iter()
            .chain(codes(&extras, "citizenships").iter())
            .map(String::as_str),
    );
    let residences = crate::sanctions::normalize::country_codes(
        codes(&contact, "country")
            .iter()
            .chain(codes(&contact, "residence_country").iter())
            .chain(codes(&extras, "country").iter())
            .map(String::as_str),
    );
    CanonicalGuardianIdentity {
        contact_id,
        related_patient_id,
        position,
        name: text(&contact, "name").unwrap_or_default(),
        citizenships,
        residences,
        role,
        contact,
        extras,
    }
}

/// Load one lead with the same transaction as its other form data.
pub async fn load(
    conn: &mut PgConnection,
    lead_id: Uuid,
) -> Result<Vec<CanonicalGuardianIdentity>, sqlx::Error> {
    load_on(conn, lead_id, crate::app_time::today()).await
}

/// Preserve the representation as of the conversion day when reading a
/// converted child's file after their eighteenth birthday.
pub async fn load_on(
    conn: &mut PgConnection,
    lead_id: Uuid,
    on: NaiveDate,
) -> Result<Vec<CanonicalGuardianIdentity>, sqlx::Error> {
    Ok(load_many_on(conn, &[lead_id], on)
        .await?
        .remove(&lead_id)
        .unwrap_or_default())
}

/// One trusted contact of a lead merged with its `lead_representatives` row,
/// whatever the relation ("Neue Anfrage für diese Person", owner decision
/// 2026-10-25: a spouse or a friend named on the request becomes a lead of
/// their own too). Same merge and country normalisation as [`load`]; a linked
/// patient is not read (the caller refuses a contact that already has an own
/// record). `None` when the lead or the contact does not exist.
pub async fn load_contact(
    conn: &mut PgConnection,
    lead_id: Uuid,
    contact_id: Uuid,
) -> Result<Option<CanonicalGuardianIdentity>, sqlx::Error> {
    let contacts: Option<Option<Value>> =
        sqlx::query_scalar("SELECT trusted_contacts FROM leads WHERE id = $1")
            .bind(lead_id)
            .fetch_optional(&mut *conn)
            .await?;
    let Some((position, contact)) = contacts
        .flatten()
        .as_ref()
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .enumerate()
        .find(|(_, contact)| uuid(contact, "id") == Some(contact_id))
        .map(|(position, contact)| (position, contact.clone()))
    else {
        return Ok(None);
    };
    let row: Option<Value> = sqlx::query_scalar(
        "SELECT to_jsonb(r) FROM lead_representatives r WHERE lead_id = $1 AND contact_id = $2",
    )
    .bind(lead_id)
    .bind(contact_id)
    .fetch_optional(&mut *conn)
    .await?;
    Ok(Some(identity(
        lead_id,
        position,
        &contact,
        row.as_ref(),
        None,
    )))
}

/// Three batched reads, regardless of the number of leads or parents.
pub async fn load_many(
    conn: &mut PgConnection,
    lead_ids: &[Uuid],
) -> Result<HashMap<Uuid, Vec<CanonicalGuardianIdentity>>, sqlx::Error> {
    load_many_on(conn, lead_ids, crate::app_time::today()).await
}

async fn load_many_on(
    conn: &mut PgConnection,
    lead_ids: &[Uuid],
    on: NaiveDate,
) -> Result<HashMap<Uuid, Vec<CanonicalGuardianIdentity>>, sqlx::Error> {
    if lead_ids.is_empty() {
        return Ok(HashMap::new());
    }
    let contacts: Vec<(Uuid, Option<Value>, Option<NaiveDate>)> =
        sqlx::query_as("SELECT id, trusted_contacts, date_of_birth FROM leads WHERE id = ANY($1)")
            .bind(lead_ids)
            .fetch_all(&mut *conn)
            .await?;
    let rows: Vec<(Uuid, Uuid, Value)> = sqlx::query_as(
        "SELECT lead_id, contact_id, to_jsonb(r) FROM lead_representatives r WHERE lead_id = ANY($1)",
    )
    .bind(lead_ids)
    .fetch_all(&mut *conn)
    .await?;
    let rows: HashMap<(Uuid, Uuid), Value> = rows
        .into_iter()
        .map(|(lead, contact, row)| ((lead, contact), row))
        .collect();
    let mut eligible = Vec::new();
    let mut patient_ids = HashSet::new();
    for (lead_id, contacts, date_of_birth) in contacts {
        let minor = crate::routes::leads::is_minor_on(date_of_birth, on);
        for (position, contact) in contacts
            .as_ref()
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .enumerate()
        {
            let row = uuid(contact, "id").and_then(|id| rows.get(&(lead_id, id)));
            let parent = crate::sanctions::screening::is_guardian_relation(
                &text(contact, "relation").unwrap_or_default(),
            );
            if !parent
                && !row.is_some_and(|row| {
                    matches!(
                        text(row, "role").as_deref(),
                        Some("authorised_representative" | "legal_guardian")
                    )
                })
            {
                continue;
            }
            if let Some(id) = uuid(contact, "related_patient_id") {
                patient_ids.insert(id);
            }
            let row = row.filter(|row| {
                let role = text(row, "role").unwrap_or_default();
                if minor {
                    role == "legal_representative"
                } else {
                    role == "authorised_representative" || role == "legal_guardian"
                }
            });
            let effective_row = row
                .cloned()
                .or_else(|| (minor && parent).then(|| json!({"role": "legal_representative"})));
            eligible.push((lead_id, position, contact.clone(), effective_row));
        }
    }
    // Only identity columns are projected from the explicitly linked patient
    // and their own original lead declaration. Whole snapshots, legal status,
    // medical records, consent answers and files never enter the result.
    let patients: Vec<(Uuid, Value)> = sqlx::query_as(
        r#"SELECT p.id, jsonb_build_object(
             'first_name', p.first_name, 'last_name', p.last_name,
             'birth_date', p.birth_date, 'email', p.email, 'phone', p.phone_primary,
             'citizenships', CASE WHEN cardinality(p.citizenships) > 0
                 THEN to_jsonb(p.citizenships) ELSE to_jsonb(p.nationality) END,
             'street', p.address_street, 'zip', p.address_zip, 'city', p.address_city,
             'country', COALESCE(NULLIF(btrim(p.address_country), ''), NULLIF(btrim(p.residence_country), '')),
             'residence_country', p.residence_country,
             'birth_place', g.birth_place, 'birth_country', g.birth_country,
             'id_document_type', CASE WHEN NULLIF(btrim(p.passport_number), '') IS NOT NULL
                 THEN 'passport' ELSE g.id_document_type END,
             'id_document_number', COALESCE(NULLIF(btrim(p.passport_number), ''), g.id_document_number),
             'id_issuing_authority', CASE WHEN NULLIF(btrim(p.passport_number), '') IS NULL
                 OR btrim(p.passport_number) = btrim(g.id_document_number) THEN g.id_issuing_authority END,
             'id_issuing_country', CASE WHEN NULLIF(btrim(p.passport_number), '') IS NULL
                 OR btrim(p.passport_number) = btrim(g.id_document_number) THEN g.id_issuing_country END,
             'id_issued_on', CASE WHEN NULLIF(btrim(p.passport_number), '') IS NULL
                 OR btrim(p.passport_number) = btrim(g.id_document_number) THEN g.id_issued_on END,
             'id_valid_until', COALESCE(p.passport_expiry, CASE
                 WHEN NULLIF(btrim(p.passport_number), '') IS NULL
                 OR btrim(p.passport_number) = btrim(g.id_document_number) THEN g.id_valid_until END))
           FROM patients p LEFT JOIN lead_gwg_declarations g ON g.lead_id = p.source_lead_id
           WHERE p.id = ANY($1) AND p.lifecycle_status <> 'deleted'
             AND p.legal_status->>'anonymized_at' IS NULL"#,
    )
    .bind(patient_ids.into_iter().collect::<Vec<_>>())
    .fetch_all(&mut *conn)
    .await?;
    let patients: HashMap<Uuid, Value> = patients.into_iter().collect();
    let mut result: HashMap<Uuid, Vec<CanonicalGuardianIdentity>> = HashMap::new();
    for (lead_id, position, contact, row) in eligible {
        let patient = uuid(&contact, "related_patient_id").and_then(|id| patients.get(&id));
        result.entry(lead_id).or_default().push(identity(
            lead_id,
            position,
            &contact,
            row.as_ref(),
            patient,
        ));
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_linked_patients_free_text_country_becomes_its_iso_code() {
        let contact = json!({
            "id": Uuid::nil().to_string(),
            "relation": "mother",
            "name": "Olena Test",
        });
        let patient = json!({
            "first_name": "Olena",
            "last_name": "Test",
            "country": "Ukraine",
            "residence_country": "Ukraine",
            "birth_country": "Atlantis",
        });
        let identity = identity(
            Uuid::nil(),
            0,
            &contact,
            Some(&json!({ "role": "legal_representative" })),
            Some(&patient),
        );
        assert_eq!(identity.extras["country"], json!("UA"));
        assert_eq!(identity.extras["birth_country"], Value::Null);
        assert_eq!(identity.residences, vec!["UA".to_string()]);
    }

    #[test]
    fn stored_country_codes_stay_codes() {
        let mut extras = json!({ "country": "de", "birth_country": "UA" });
        normalize_countries(&mut extras);
        assert_eq!(extras, json!({ "country": "DE", "birth_country": "UA" }));
    }
}
