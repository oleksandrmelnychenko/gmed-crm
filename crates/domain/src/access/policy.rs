use super::data_sensitivity::DataSensitivity;
use super::share_status::ShareStatus;
use crate::role::Role;
use uuid::Uuid;

#[derive(Debug)]
pub struct AccessContext {
    pub role: Role,
    pub user_id: Uuid,
    pub is_assigned: bool,
    pub data_sensitivity: DataSensitivity,
    pub share_status: Option<ShareStatus>,
}

#[derive(Debug, Clone)]
pub struct AccessDecision {
    pub allowed: bool,
    pub reason: &'static str,
}

impl AccessDecision {
    fn allow(reason: &'static str) -> Self {
        Self {
            allowed: true,
            reason,
        }
    }
    fn deny(reason: &'static str) -> Self {
        Self {
            allowed: false,
            reason,
        }
    }
}

pub fn check_access(ctx: &AccessContext) -> AccessDecision {
    let AccessContext {
        role,
        user_id: _,
        is_assigned,
        data_sensitivity,
        share_status,
    } = ctx;

    if *role == Role::Ceo {
        return AccessDecision::allow("CEO has full access");
    }

    let requires_assignment = match role {
        Role::PatientManager => true,
        Role::TeamleadInterpreter => true,
        Role::Interpreter => true,
        Role::Concierge => true,
        Role::Patient => true,
        Role::Ceo => false,
        Role::CeoAssistant => false,
        Role::Billing => false,
        Role::Sales => false,
        Role::ItAdmin => false,
    };

    if requires_assignment && !is_assigned {
        return AccessDecision::deny("Not assigned to this patient");
    }

    let sensitivity_allowed = match role {
        Role::Ceo => true,

        Role::CeoAssistant => match data_sensitivity {
            DataSensitivity::General => true,
            DataSensitivity::Internal => true,
            DataSensitivity::PatientIdentity => is_released(*share_status),
            DataSensitivity::Medical => is_released(*share_status),
            DataSensitivity::Financial => is_released(*share_status),
            DataSensitivity::Service => is_released(*share_status),
        },

        Role::PatientManager => true,

        Role::TeamleadInterpreter => match data_sensitivity {
            DataSensitivity::General => true,
            DataSensitivity::PatientIdentity => true,
            DataSensitivity::Internal => true,
            DataSensitivity::Medical => false,
            DataSensitivity::Financial => false,
            DataSensitivity::Service => false,
        },

        Role::Interpreter => match data_sensitivity {
            DataSensitivity::General => true,
            DataSensitivity::PatientIdentity => true,
            DataSensitivity::Medical => true,
            DataSensitivity::Financial => false,
            DataSensitivity::Internal => false,
            DataSensitivity::Service => false,
        },

        Role::Concierge => match data_sensitivity {
            DataSensitivity::General => true,
            DataSensitivity::PatientIdentity => true,
            DataSensitivity::Service => true,
            DataSensitivity::Medical => false,
            DataSensitivity::Financial => false,
            DataSensitivity::Internal => false,
        },

        Role::Billing => match data_sensitivity {
            DataSensitivity::General => true,
            DataSensitivity::PatientIdentity => true,
            DataSensitivity::Financial => true,
            DataSensitivity::Medical => false,
            DataSensitivity::Internal => false,
            DataSensitivity::Service => false,
        },

        Role::Sales => match data_sensitivity {
            DataSensitivity::General => true,
            DataSensitivity::PatientIdentity => false,
            DataSensitivity::Medical => false,
            DataSensitivity::Financial => false,
            DataSensitivity::Internal => false,
            DataSensitivity::Service => false,
        },

        Role::ItAdmin => match data_sensitivity {
            DataSensitivity::General => true,
            DataSensitivity::PatientIdentity => false,
            DataSensitivity::Medical => false,
            DataSensitivity::Financial => false,
            DataSensitivity::Internal => false,
            DataSensitivity::Service => false,
        },

        Role::Patient => true,
    };

    if !sensitivity_allowed {
        return AccessDecision::deny("Role does not have access to this data category");
    }

    match role {
        Role::Patient => match share_status {
            Some(ShareStatus::PatientVisible) => {
                AccessDecision::allow("Item is released for patient")
            }
            Some(ShareStatus::InternalOnly) => {
                AccessDecision::deny("Item is not released for patient portal")
            }
            Some(ShareStatus::ReleasedInternal) => {
                AccessDecision::deny("Item is not released for patient portal")
            }
            Some(ShareStatus::ReleasedExternal) => {
                AccessDecision::deny("Item is not released for patient portal")
            }
            None => AccessDecision::deny("Item is not released for patient portal"),
        },

        Role::Interpreter => {
            if *data_sensitivity == DataSensitivity::Medical {
                match share_status {
                    Some(ShareStatus::ReleasedInternal) => {
                        AccessDecision::allow("Medical data released for interpreter assignment")
                    }
                    Some(ShareStatus::ReleasedExternal) => {
                        AccessDecision::allow("Medical data released for interpreter assignment")
                    }
                    Some(ShareStatus::PatientVisible) => {
                        AccessDecision::allow("Medical data released for interpreter assignment")
                    }
                    Some(ShareStatus::InternalOnly) => {
                        AccessDecision::deny("Medical data not released for interpreter")
                    }
                    None => AccessDecision::deny("Medical data not released for interpreter"),
                }
            } else {
                AccessDecision::allow("Basic data access for interpreter")
            }
        }

        Role::CeoAssistant => {
            let needs_release = match data_sensitivity {
                DataSensitivity::PatientIdentity => true,
                DataSensitivity::Medical => true,
                DataSensitivity::Financial => true,
                DataSensitivity::General => false,
                DataSensitivity::Internal => false,
                DataSensitivity::Service => false,
            };
            if needs_release {
                if is_released(*share_status) {
                    AccessDecision::allow("Data released for CEO assistant")
                } else {
                    AccessDecision::deny("Data not released for CEO assistant")
                }
            } else {
                AccessDecision::allow("General/internal access for CEO assistant")
            }
        }

        Role::Ceo => AccessDecision::allow("CEO has full access"),
        Role::PatientManager => AccessDecision::allow("Access granted by role and sensitivity"),
        Role::TeamleadInterpreter => {
            AccessDecision::allow("Access granted by role and sensitivity")
        }
        Role::Concierge => AccessDecision::allow("Access granted by role and sensitivity"),
        Role::Billing => AccessDecision::allow("Access granted by role and sensitivity"),
        Role::Sales => AccessDecision::allow("Access granted by role and sensitivity"),
        Role::ItAdmin => AccessDecision::allow("Access granted by role and sensitivity"),
    }
}

fn is_released(status: Option<ShareStatus>) -> bool {
    match status {
        Some(ShareStatus::ReleasedInternal) => true,
        Some(ShareStatus::ReleasedExternal) => true,
        Some(ShareStatus::PatientVisible) => true,
        Some(ShareStatus::InternalOnly) => false,
        None => false,
    }
}

pub fn can_share_with_provider(
    share_status: ShareStatus,
    data_sensitivity: DataSensitivity,
    is_medical_provider: bool,
    is_provider_in_order: bool,
) -> AccessDecision {
    if share_status == ShareStatus::InternalOnly {
        return AccessDecision::deny("Cannot share internal-only documents");
    }

    if !share_status.can_share_externally() {
        return AccessDecision::deny("Document not released for external sharing");
    }

    if !is_provider_in_order {
        return AccessDecision::deny("Provider is not involved in this order");
    }

    if data_sensitivity == DataSensitivity::Medical && !is_medical_provider {
        return AccessDecision::deny("Medical documents can only be shared with medical providers");
    }

    if data_sensitivity == DataSensitivity::Medical {
        AccessDecision::allow("Medical document sharing — requires explicit confirmation")
    } else {
        AccessDecision::allow("Document sharing permitted")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx(
        role: Role,
        assigned: bool,
        sensitivity: DataSensitivity,
        share: Option<ShareStatus>,
    ) -> AccessContext {
        AccessContext {
            role,
            user_id: Uuid::new_v4(),
            is_assigned: assigned,
            data_sensitivity: sensitivity,
            share_status: share,
        }
    }

    #[test]
    fn ceo_has_full_access() {
        let c = ctx(Role::Ceo, false, DataSensitivity::Medical, None);
        assert!(check_access(&c).allowed);
    }

    #[test]
    fn pm_can_access_assigned_patient_medical() {
        let c = ctx(Role::PatientManager, true, DataSensitivity::Medical, None);
        assert!(check_access(&c).allowed);
    }

    #[test]
    fn pm_cannot_access_unassigned_patient() {
        let c = ctx(Role::PatientManager, false, DataSensitivity::Medical, None);
        assert!(!check_access(&c).allowed);
    }

    #[test]
    fn interpreter_cannot_see_unreleased_medical() {
        let c = ctx(
            Role::Interpreter,
            true,
            DataSensitivity::Medical,
            Some(ShareStatus::InternalOnly),
        );
        assert!(!check_access(&c).allowed);
    }

    #[test]
    fn interpreter_can_see_released_medical() {
        let c = ctx(
            Role::Interpreter,
            true,
            DataSensitivity::Medical,
            Some(ShareStatus::ReleasedInternal),
        );
        assert!(check_access(&c).allowed);
    }

    #[test]
    fn interpreter_cannot_see_financial() {
        let c = ctx(Role::Interpreter, true, DataSensitivity::Financial, None);
        assert!(!check_access(&c).allowed);
    }

    #[test]
    fn interpreter_unassigned_denied() {
        let c = ctx(Role::Interpreter, false, DataSensitivity::General, None);
        assert!(!check_access(&c).allowed);
    }

    #[test]
    fn concierge_cannot_see_medical() {
        let c = ctx(Role::Concierge, true, DataSensitivity::Medical, None);
        assert!(!check_access(&c).allowed);
    }

    #[test]
    fn concierge_can_see_service() {
        let c = ctx(Role::Concierge, true, DataSensitivity::Service, None);
        assert!(check_access(&c).allowed);
    }

    #[test]
    fn billing_cannot_see_medical() {
        let c = ctx(Role::Billing, true, DataSensitivity::Medical, None);
        assert!(!check_access(&c).allowed);
    }

    #[test]
    fn billing_can_see_financial() {
        let c = ctx(Role::Billing, true, DataSensitivity::Financial, None);
        assert!(check_access(&c).allowed);
    }

    #[test]
    fn patient_can_only_see_patient_visible() {
        let c = ctx(
            Role::Patient,
            true,
            DataSensitivity::Medical,
            Some(ShareStatus::PatientVisible),
        );
        assert!(check_access(&c).allowed);
    }

    #[test]
    fn patient_cannot_see_internal() {
        let c = ctx(
            Role::Patient,
            true,
            DataSensitivity::Medical,
            Some(ShareStatus::InternalOnly),
        );
        assert!(!check_access(&c).allowed);
    }

    #[test]
    fn patient_cannot_see_released_internal() {
        let c = ctx(
            Role::Patient,
            true,
            DataSensitivity::Medical,
            Some(ShareStatus::ReleasedInternal),
        );
        assert!(!check_access(&c).allowed);
    }

    #[test]
    fn sales_cannot_see_patient_data() {
        let c = ctx(Role::Sales, false, DataSensitivity::PatientIdentity, None);
        assert!(!check_access(&c).allowed);
    }

    #[test]
    fn cannot_share_internal_doc() {
        let d = can_share_with_provider(
            ShareStatus::InternalOnly,
            DataSensitivity::General,
            true,
            true,
        );
        assert!(!d.allowed);
    }

    #[test]
    fn cannot_share_with_unrelated_provider() {
        let d = can_share_with_provider(
            ShareStatus::ReleasedExternal,
            DataSensitivity::General,
            true,
            false,
        );
        assert!(!d.allowed);
    }

    #[test]
    fn cannot_share_medical_with_non_medical_provider() {
        let d = can_share_with_provider(
            ShareStatus::ReleasedExternal,
            DataSensitivity::Medical,
            false,
            true,
        );
        assert!(!d.allowed);
    }

    #[test]
    fn can_share_medical_with_medical_provider() {
        let d = can_share_with_provider(
            ShareStatus::ReleasedExternal,
            DataSensitivity::Medical,
            true,
            true,
        );
        assert!(d.allowed);
    }
}
