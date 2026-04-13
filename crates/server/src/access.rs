use std::collections::HashSet;

use gmed_db::DbPool;
use gmed_domain::role::Role;
use sqlx::Row;
use uuid::Uuid;

pub fn requires_patient_assignment(role: Role) -> bool {
    matches!(
        role,
        Role::PatientManager | Role::TeamleadInterpreter | Role::Interpreter | Role::Concierge
    )
}

pub fn role_db_name(role: Role) -> Option<&'static str> {
    match role {
        Role::Ceo => Some("ceo"),
        Role::CeoAssistant => Some("ceo_assistant"),
        Role::PatientManager => Some("patient_manager"),
        Role::TeamleadInterpreter => Some("teamlead_interpreter"),
        Role::Interpreter => Some("interpreter"),
        Role::Concierge => Some("concierge"),
        Role::Billing => Some("billing"),
        Role::Sales => Some("sales"),
        Role::ItAdmin => Some("it_admin"),
        Role::Patient => Some("patient"),
        _ => None,
    }
}

pub async fn has_active_patient_assignment(
    pool: &DbPool,
    patient_id: Uuid,
    user_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let row = sqlx::query(
        r#"SELECT EXISTS(
            SELECT 1
            FROM patient_assignments
            WHERE patient_id = $1
              AND user_id = $2
              AND revoked_at IS NULL
        )"#,
    )
    .bind(patient_id)
    .bind(user_id)
    .fetch_one(pool)
    .await?;

    row.try_get(0)
}

pub async fn load_active_patient_assignment_set(
    pool: &DbPool,
    user_id: Uuid,
) -> Result<HashSet<Uuid>, sqlx::Error> {
    let rows = sqlx::query(
        r#"SELECT patient_id
           FROM patient_assignments
           WHERE user_id = $1
             AND revoked_at IS NULL"#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .filter_map(|row| row.try_get::<Uuid, _>("patient_id").ok())
        .collect())
}

pub fn mask_email(value: &str) -> String {
    let mut parts = value.split('@');
    let local = parts.next().unwrap_or_default();
    let domain = parts.next().unwrap_or_default();

    if local.is_empty() || domain.is_empty() {
        return value.to_string();
    }

    let first = local.chars().next().unwrap_or('*');
    format!("{first}***@{domain}")
}

pub fn mask_phone(value: &str) -> String {
    let digits: String = value.chars().filter(|c| c.is_ascii_digit()).collect();
    if digits.len() <= 4 {
        return "***".to_string();
    }

    let suffix = &digits[digits.len() - 4..];
    format!("***{suffix}")
}
