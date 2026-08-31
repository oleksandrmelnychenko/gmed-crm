use std::collections::HashSet;

use gmed_db::DbPool;
use gmed_domain::access::resource_access::{
    AccessEffect, AccessRuleSource, ResourceAccessDecision, ResourceAccessRequest,
    passes_absolute_resource_boundary,
};
use gmed_domain::role::Role;
use sqlx::Row;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecordSubject {
    Patient(Uuid),
    Lead(Uuid),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecordSubjectError {
    Missing,
    Ambiguous,
}

impl RecordSubject {
    pub fn from_ids(
        patient_id: Option<Uuid>,
        lead_id: Option<Uuid>,
    ) -> Result<Self, RecordSubjectError> {
        match (patient_id, lead_id) {
            (Some(patient_id), None) => Ok(Self::Patient(patient_id)),
            (None, Some(lead_id)) => Ok(Self::Lead(lead_id)),
            (None, None) => Err(RecordSubjectError::Missing),
            (Some(_), Some(_)) => Err(RecordSubjectError::Ambiguous),
        }
    }

    pub fn patient_id(self) -> Option<Uuid> {
        match self {
            Self::Patient(id) => Some(id),
            Self::Lead(_) => None,
        }
    }

    pub fn lead_id(self) -> Option<Uuid> {
        match self {
            Self::Patient(_) => None,
            Self::Lead(id) => Some(id),
        }
    }
}

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

pub async fn has_active_concierge_task_patient_access(
    pool: &DbPool,
    patient_id: Uuid,
    user_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let row = sqlx::query(
        r#"SELECT EXISTS(
            SELECT 1
            FROM tasks task
            LEFT JOIN concierge_services service
              ON service.id = task.concierge_service_id
            WHERE task.task_scope = 'concierge_operational'
              AND task.assigned_to = $2
              AND COALESCE(task.patient_id, service.patient_id) = $1
              AND task.deleted_at IS NULL
              AND task.archived_at IS NULL
        )"#,
    )
    .bind(patient_id)
    .bind(user_id)
    .fetch_one(pool)
    .await?;

    row.try_get(0)
}

pub async fn load_active_concierge_task_patient_access_set(
    pool: &DbPool,
    user_id: Uuid,
) -> Result<HashSet<Uuid>, sqlx::Error> {
    let rows = sqlx::query(
        r#"SELECT DISTINCT COALESCE(task.patient_id, service.patient_id) AS patient_id
           FROM tasks task
           LEFT JOIN concierge_services service
             ON service.id = task.concierge_service_id
           WHERE task.task_scope = 'concierge_operational'
             AND task.assigned_to = $1
             AND COALESCE(task.patient_id, service.patient_id) IS NOT NULL
             AND task.deleted_at IS NULL
             AND task.archived_at IS NULL"#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .filter_map(|row| row.try_get::<Uuid, _>("patient_id").ok())
        .collect())
}

/// Resolve only explicit reusable-profile and per-user resource rules.
///
/// `NoExplicitRule` deliberately leaves the existing role/assignment policy in
/// control. Direct user rules override profile rules; record-specific rules
/// override `all` rules; a deny wins when candidates are otherwise equal.
pub async fn resolve_explicit_resource_access(
    pool: &DbPool,
    user_id: Uuid,
    role: Role,
    request: ResourceAccessRequest,
) -> Result<ResourceAccessDecision, sqlx::Error> {
    if role == Role::Ceo {
        return Ok(ResourceAccessDecision::Allow(AccessRuleSource::Ceo));
    }
    if !passes_absolute_resource_boundary(role, &request) {
        return Ok(ResourceAccessDecision::DenySystemBoundary);
    }

    let Some(role_name) = role_db_name(role) else {
        return Ok(ResourceAccessDecision::NoExplicitRule);
    };

    let candidate = sqlx::query(
        r#"WITH candidates AS (
               SELECT direct.effect,
                      'user'::text AS source,
                      2::int AS source_priority,
                      CASE direct.scope_type WHEN 'record' THEN 2 ELSE 1 END AS specificity
               FROM staff_user_access_rules direct
               WHERE direct.user_id = $1
                 AND direct.granted_for_role = $2
                 AND direct.resource_type = $3
                 AND direct.capability = $4
                 AND direct.revoked_at IS NULL
                 AND direct.valid_from <= now()
                 AND (direct.valid_until IS NULL OR direct.valid_until > now())
                 AND (
                      direct.scope_type = 'all'
                      OR (direct.scope_type = 'record' AND direct.resource_id = $5)
                 )

               UNION ALL

               SELECT rule.effect,
                      'profile'::text AS source,
                      1::int AS source_priority,
                      CASE rule.scope_type WHEN 'record' THEN 2 ELSE 1 END AS specificity
               FROM staff_access_profile_assignments assignment
               JOIN staff_access_profiles profile
                 ON profile.id = assignment.profile_id
                AND profile.is_active = true
               JOIN staff_access_profile_roles profile_role
                 ON profile_role.profile_id = profile.id
                AND profile_role.role = $2
               JOIN staff_access_profile_rules rule
                 ON rule.profile_id = profile.id
               WHERE assignment.user_id = $1
                 AND assignment.assigned_for_role = $2
                 AND assignment.revoked_at IS NULL
                 AND assignment.valid_from <= now()
                 AND (assignment.valid_until IS NULL OR assignment.valid_until > now())
                 AND rule.resource_type = $3
                 AND rule.capability = $4
                 AND (
                      rule.scope_type = 'all'
                      OR (rule.scope_type = 'record' AND rule.resource_id = $5)
                 )
           )
           SELECT effect, source
           FROM candidates
           ORDER BY source_priority DESC,
                    specificity DESC,
                    CASE effect WHEN 'deny' THEN 1 ELSE 0 END DESC
           LIMIT 1"#,
    )
    .bind(user_id)
    .bind(role_name)
    .bind(request.resource_type.as_str())
    .bind(request.capability.as_str())
    .bind(request.resource_id)
    .fetch_optional(pool)
    .await?;

    let Some(candidate) = candidate else {
        return Ok(ResourceAccessDecision::NoExplicitRule);
    };
    let effect = candidate
        .try_get::<String, _>("effect")
        .ok()
        .and_then(|value| AccessEffect::from_db(&value));
    let source = match candidate.try_get::<String, _>("source").as_deref() {
        Ok("user") => Some(AccessRuleSource::UserRule),
        Ok("profile") => Some(AccessRuleSource::ProfileRule),
        _ => None,
    };

    Ok(match (effect, source) {
        (Some(AccessEffect::Allow), Some(source)) => ResourceAccessDecision::Allow(source),
        (Some(AccessEffect::Deny), Some(source)) => ResourceAccessDecision::Deny(source),
        _ => ResourceAccessDecision::NoExplicitRule,
    })
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

#[cfg(test)]
mod tests {
    use super::{RecordSubject, RecordSubjectError};
    use uuid::Uuid;

    #[test]
    fn record_subject_requires_exactly_one_id() {
        let patient_id = Uuid::new_v4();
        let lead_id = Uuid::new_v4();

        assert_eq!(
            RecordSubject::from_ids(Some(patient_id), None),
            Ok(RecordSubject::Patient(patient_id))
        );
        assert_eq!(
            RecordSubject::from_ids(None, Some(lead_id)),
            Ok(RecordSubject::Lead(lead_id))
        );
        assert_eq!(
            RecordSubject::from_ids(None, None),
            Err(RecordSubjectError::Missing)
        );
        assert_eq!(
            RecordSubject::from_ids(Some(patient_id), Some(lead_id)),
            Err(RecordSubjectError::Ambiguous)
        );
    }

    #[test]
    fn record_subject_exposes_only_its_active_id() {
        let patient_id = Uuid::new_v4();
        let lead_id = Uuid::new_v4();

        let patient = RecordSubject::Patient(patient_id);
        assert_eq!(patient.patient_id(), Some(patient_id));
        assert_eq!(patient.lead_id(), None);

        let lead = RecordSubject::Lead(lead_id);
        assert_eq!(lead.patient_id(), None);
        assert_eq!(lead.lead_id(), Some(lead_id));
    }
}
