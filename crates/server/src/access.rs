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

/// Row-level appointment scope of a role: which appointments it may open once
/// a capability (`appointments.view`, …) admitted it to the module.
///
/// A patient assignment is not the same as an appointment assignment. An
/// interpreter is linked to the patient while booked on one of the patient's
/// visits (see `services::interpreter_booking_links`), but that link must not
/// open the patient's whole calendar (other interpreters' visits, their notes,
/// reports and communication). The interpreter therefore sees only the
/// appointments it runs or owns, with or without the link.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AppointmentScope {
    /// Every appointment (roles outside the assignment model).
    pub all: bool,
    /// Appointments where the caller is the booked interpreter.
    pub as_interpreter: bool,
    /// Appointments the caller owns (`owner_user_id`).
    pub as_owner: bool,
    /// Every appointment of a patient the caller is assigned to.
    pub via_patient_assignment: bool,
    /// Every appointment that involves an interpreter (booked, or with an
    /// interpreter report): the interpreter team lead plans the team and
    /// approves its reports without being assigned to each patient.
    pub interpreter_team: bool,
}

impl AppointmentScope {
    pub fn for_role(role: Role) -> Self {
        let none = Self {
            all: false,
            as_interpreter: false,
            as_owner: false,
            via_patient_assignment: false,
            interpreter_team: false,
        };
        match role {
            Role::Ceo => Self { all: true, ..none },
            Role::Interpreter => Self {
                as_interpreter: true,
                as_owner: true,
                ..none
            },
            Role::TeamleadInterpreter => Self {
                as_interpreter: true,
                as_owner: true,
                via_patient_assignment: true,
                interpreter_team: true,
                ..none
            },
            Role::PatientManager | Role::Concierge => Self {
                as_owner: true,
                via_patient_assignment: true,
                ..none
            },
            // The patient portal has its own `/me/appointments` contract; the
            // remaining staff roles are not assignment-scoped and are gated
            // by capabilities before any row is read.
            role => Self {
                all: !requires_patient_assignment(role),
                ..none
            },
        }
    }

    /// The scope for changing an appointment: the team lead's team context
    /// is a read and report-review scope, not a licence to edit the visits of
    /// patients it is not assigned to.
    pub fn for_change(self) -> Self {
        Self {
            interpreter_team: false,
            ..self
        }
    }

    /// Whether the scope admits an appointment without a database lookup.
    /// `None` means the answer depends on the caller's patient assignment.
    pub fn admits_directly(
        self,
        user_id: Uuid,
        interpreter_id: Option<Uuid>,
        owner_user_id: Option<Uuid>,
    ) -> Option<bool> {
        if self.all
            || (self.as_interpreter && interpreter_id == Some(user_id))
            || (self.as_owner && owner_user_id == Some(user_id))
            || (self.interpreter_team && interpreter_id.is_some())
        {
            return Some(true);
        }
        if self.via_patient_assignment || self.interpreter_team {
            None
        } else {
            Some(false)
        }
    }
}

/// Whether an appointment is read or changed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AppointmentAccess {
    Read,
    Change,
}

/// The appointment and the caller of an appointment-level check.
#[derive(Debug, Clone, Copy)]
pub struct AppointmentRow {
    pub role: Role,
    pub user_id: Uuid,
    pub appointment_id: Uuid,
    pub patient_id: Uuid,
    pub interpreter_id: Option<Uuid>,
    pub owner_user_id: Option<Uuid>,
}

/// Appointment-level check shared by the appointment API, the patient card
/// and realtime delivery.
pub async fn can_view_appointment_row(
    pool: &DbPool,
    row: AppointmentRow,
    access: AppointmentAccess,
) -> Result<bool, sqlx::Error> {
    let scope = match access {
        AppointmentAccess::Read => AppointmentScope::for_role(row.role),
        AppointmentAccess::Change => AppointmentScope::for_role(row.role).for_change(),
    };
    if let Some(decision) =
        scope.admits_directly(row.user_id, row.interpreter_id, row.owner_user_id)
    {
        return Ok(decision);
    }
    // An interpreter report keeps the visit in the team lead's scope even
    // after the interpreter was taken off the appointment.
    if scope.interpreter_team
        && sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM interpreter_reports WHERE appointment_id = $1)",
        )
        .bind(row.appointment_id)
        .fetch_one(pool)
        .await?
    {
        return Ok(true);
    }
    if scope.via_patient_assignment {
        has_active_patient_assignment(pool, row.patient_id, row.user_id).await
    } else {
        Ok(false)
    }
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
            WHERE task.task_scope IN ('general', 'concierge_operational')
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
           WHERE task.task_scope IN ('general', 'concierge_operational')
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
    use super::{AppointmentScope, RecordSubject, RecordSubjectError};
    use gmed_domain::role::Role;
    use uuid::Uuid;

    #[test]
    fn interpreter_sees_only_appointments_it_runs_or_owns() {
        let me = Uuid::new_v4();
        let other = Uuid::new_v4();
        let scope = AppointmentScope::for_role(Role::Interpreter);
        assert!(!scope.via_patient_assignment);
        assert_eq!(scope.admits_directly(me, Some(me), None), Some(true));
        assert_eq!(scope.admits_directly(me, None, Some(me)), Some(true));
        // Another interpreter's visit of the same patient stays closed, even
        // though booking the first visit linked the interpreter to the patient.
        assert_eq!(
            scope.admits_directly(me, Some(other), Some(other)),
            Some(false)
        );
        assert_eq!(scope.admits_directly(me, None, None), Some(false));
    }

    #[test]
    fn interpreter_team_lead_sees_every_interpreter_appointment() {
        let me = Uuid::new_v4();
        let interpreter = Uuid::new_v4();
        let scope = AppointmentScope::for_role(Role::TeamleadInterpreter);
        assert!(scope.interpreter_team);
        assert_eq!(
            scope.admits_directly(me, Some(interpreter), None),
            Some(true)
        );
        // Without a booked interpreter the patient assignment (or a report,
        // checked against the database) decides.
        assert_eq!(scope.admits_directly(me, None, None), None);
        for role in [Role::Interpreter, Role::PatientManager, Role::Concierge] {
            assert!(
                !AppointmentScope::for_role(role).interpreter_team,
                "{role:?}"
            );
        }
        assert_eq!(
            AppointmentScope::for_role(Role::Concierge).admits_directly(
                me,
                Some(interpreter),
                None
            ),
            None
        );
        // Changing an appointment stays with the previous rule.
        let change = scope.for_change();
        assert!(!change.interpreter_team);
        assert_eq!(change.admits_directly(me, Some(interpreter), None), None);
        assert_eq!(change.admits_directly(me, Some(me), None), Some(true));
    }

    #[test]
    fn assignment_roles_fall_back_to_patient_assignment() {
        let me = Uuid::new_v4();
        for role in [
            Role::PatientManager,
            Role::Concierge,
            Role::TeamleadInterpreter,
        ] {
            let scope = AppointmentScope::for_role(role);
            assert_eq!(scope.admits_directly(me, None, None), None, "{role:?}");
            assert_eq!(scope.admits_directly(me, None, Some(me)), Some(true));
        }
        assert_eq!(
            AppointmentScope::for_role(Role::Ceo).admits_directly(me, None, None),
            Some(true)
        );
        assert_eq!(
            AppointmentScope::for_role(Role::Billing).admits_directly(me, None, None),
            Some(true)
        );
    }

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
