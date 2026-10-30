//! Read-only staff view of the patient's Anlage 1 choices.
//! Older installations have no choice store; that absence is not a refusal.
//! The caller applies the same authorization as the other cabinet statements.

use chrono::{DateTime, Utc};
use serde_json::{Value, json};
use sqlx::Row;
use uuid::Uuid;

const OPTION_KEYS: [&str; 8] = [
    "agency_processing",
    "doctors_to_agency",
    "data_system",
    "named_recipients",
    "channel_email",
    "channel_threema",
    "channel_whatsapp",
    "channel_telegram",
];

fn choice_values(value: &Value) -> Value {
    let options = OPTION_KEYS
        .into_iter()
        .map(|key| {
            (
                key.to_string(),
                value
                    .get(key)
                    .and_then(Value::as_bool)
                    .map(Value::Bool)
                    .unwrap_or(Value::Null),
            )
        })
        .collect();
    Value::Object(options)
}

fn representative_role(minor: bool, role: &str, guardian: bool) -> &'static str {
    use super::lead_representatives::{ROLE_AUTHORISED_REPRESENTATIVE, ROLE_LEGAL_GUARDIAN};
    if minor {
        return if guardian {
            "Vormund"
        } else {
            "Personensorgeberechtigte/r"
        };
    }
    match role {
        ROLE_LEGAL_GUARDIAN => "rechtliche Betreuung",
        ROLE_AUTHORISED_REPRESENTATIVE => "bevollmächtigte Person",
        _ => "Vertreter/in",
    }
}

pub(super) async fn load(
    db: &gmed_db::DbPool,
    lead_id: Uuid,
    subject_name: &str,
) -> Result<Value, sqlx::Error> {
    let supported: bool =
        sqlx::query_scalar("SELECT to_regclass('consent_form_choices') IS NOT NULL")
            .fetch_one(db)
            .await?;
    if !supported {
        return Ok(Value::Null);
    }
    // Same selection rule as consent_choices::current_for: a minor's own
    // choice does not become the guardian's consent. seq orders append-only saves.
    let row = sqlx::query(
        r#"
        SELECT c.choices, c.text_version, c.chosen_at, c.chosen_by, c.access_kind,
               c.recorded_how, c.recorded_note,
               COALESCE(to_jsonb(c) -> 'recipients', '[]'::jsonb) AS recipients,
               to_jsonb(c) -> 'disclosure' AS disclosure
        FROM consent_form_choices c
        LEFT JOIN leads subject ON subject.id = c.lead_id
        WHERE c.template_id = 'privacy_consents' AND c.lead_id = $1
          AND NOT (
              c.access_kind = 'self' AND subject.date_of_birth IS NOT NULL
              AND subject.date_of_birth
                  > ((c.chosen_at AT TIME ZONE 'Europe/Berlin')::date - INTERVAL '18 years')
          )
        ORDER BY c.seq DESC LIMIT 1
    "#,
    )
    .bind(lead_id)
    .fetch_optional(db)
    .await?;
    let Some(row) = row else {
        return Ok(json!({ "choices": null, "chosen_at": null }));
    };
    let choices: Value = row.try_get("choices")?;
    let chooser: Option<Uuid> = row.try_get("chosen_by")?;
    let access_kind: String = row.try_get("access_kind")?;
    let mut name = (access_kind == "self")
        .then(|| subject_name.trim().to_string())
        .filter(|name| !name.is_empty() && chooser.is_some());
    let mut role = None;
    if access_kind == "guardian"
        && let Some(user_id) = chooser
    {
        let contact: Option<Option<Uuid>> = sqlx::query_scalar(
            r#"
            SELECT trusted_contact_id FROM lead_portal_access
            WHERE lead_id = $1 AND user_id = $2 AND kind = 'guardian'
            ORDER BY (revoked_at IS NULL) DESC, created_at DESC LIMIT 1
        "#,
        )
        .bind(lead_id)
        .bind(user_id)
        .fetch_optional(db)
        .await?;
        if let Some(contact_id) = contact.flatten() {
            let mut conn = db.acquire().await?;
            if let Some(loaded) = super::lead_representatives::load(&mut conn, lead_id).await?
                && let Some(person) = loaded.representation.find(contact_id)
            {
                name = Some(person.name()).filter(|name| !name.is_empty());
                role = Some(representative_role(
                    loaded.representation.minor,
                    person.role,
                    person.is_guardian_of_minor(loaded.representation.answers.custody()),
                ));
            }
        }
        if name.is_none() {
            name = sqlx::query_scalar::<_, String>("SELECT name FROM users WHERE id = $1")
                .bind(user_id)
                .fetch_optional(db)
                .await?
                .map(|name| name.trim().to_string())
                .filter(|name| !name.is_empty());
        }
    }
    let recorded_how: Option<String> = row.try_get("recorded_how")?;
    let recorded_note: Option<String> = row.try_get("recorded_note")?;
    let mut disclosure: Option<Value> = row.try_get("disclosure")?;
    // The trusted persons are saved with the same row: staff recorded them the same way.
    if let Some(d) = disclosure.as_mut().filter(|d| d.is_object())
        && recorded_how.is_some()
    {
        d["recorded_how"] = json!(recorded_how);
        d["recorded_note"] = json!(recorded_note);
    }
    if let Some(d) = disclosure
        .as_mut()
        .filter(|d| d.get("chosen_by_name").is_none())
        && let Some(user_id) = d
            .get("chosen_by")
            .and_then(Value::as_str)
            .and_then(|s| Uuid::parse_str(s).ok())
    {
        let original_name: Option<String> =
            sqlx::query_scalar("SELECT name FROM users WHERE id = $1")
                .bind(user_id)
                .fetch_optional(db)
                .await?;
        d["chosen_by_name"] = json!(original_name);
    }
    let core_unanswered = disclosure.is_some()
        && serde_json::from_value::<crate::consent_choices::ConsentChoices>(choices.clone())
            .is_ok_and(|c| !c.has_core());
    Ok(json!({
        "version": row.try_get::<String, _>("text_version")?,
        "choices": if core_unanswered { Value::Null } else { choice_values(&choices) },
        // The persons named for "named recipients" (owner 2026-10-12); not
        // sanctions-screened.
        "recipients": row.try_get::<Value, _>("recipients")?,
        "disclosure": disclosure,
        "chosen_at": row.try_get::<DateTime<Utc>, _>("chosen_at")?,
        "chosen_by": chooser,
        "chosen_by_name": name,
        "chosen_by_role": role,
        "access_kind": access_kind,
        // How the client gave the choice staff recorded (owner 2026-10-29).
        "recorded_how": recorded_how,
        "recorded_note": recorded_note,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unrecorded_answers_are_unknown_and_false_is_preserved() {
        let choices = choice_values(&json!({
            "agency_processing": true, "channel_email": false,
            "channel_telegram": "true", "extra": true
        }));
        assert_eq!(choices["agency_processing"], true);
        assert_eq!(choices["channel_email"], false);
        assert!(choices["doctors_to_agency"].is_null());
        assert!(choices["channel_telegram"].is_null());
        assert!(choices.get("extra").is_none());
        assert_eq!(choices.as_object().unwrap().len(), 8);
    }

    #[test]
    fn describes_the_actual_representative_role() {
        assert_eq!(
            representative_role(true, "legal_representative", true),
            "Vormund"
        );
        assert_eq!(
            representative_role(true, "legal_representative", false),
            "Personensorgeberechtigte/r"
        );
        assert_eq!(
            representative_role(false, "legal_guardian", false),
            "rechtliche Betreuung"
        );
        assert_eq!(
            representative_role(false, "authorised_representative", false),
            "bevollmächtigte Person"
        );
    }
}
