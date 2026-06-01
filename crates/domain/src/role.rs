use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[non_exhaustive]
pub enum Role {
    Ceo,
    CeoAssistant,
    PatientManager,
    TeamleadInterpreter,
    Interpreter,
    Concierge,
    Billing,
    Sales,
    ItAdmin,
    Patient,
}

impl Role {
    pub fn has_full_access(&self) -> bool {
        match self {
            Role::Ceo => true,
            Role::CeoAssistant => false,
            Role::PatientManager => false,
            Role::TeamleadInterpreter => false,
            Role::Interpreter => false,
            Role::Concierge => false,
            Role::Billing => false,
            Role::Sales => false,
            Role::ItAdmin => true,
            Role::Patient => false,
        }
    }

    pub fn can_see_medical_data(&self) -> bool {
        match self {
            Role::Ceo => true,
            Role::CeoAssistant => true,
            Role::PatientManager => true,
            Role::TeamleadInterpreter => true,
            Role::Interpreter => true,
            Role::Concierge => false,
            Role::Billing => false,
            Role::Sales => false,
            Role::ItAdmin => true,
            Role::Patient => false,
        }
    }

    pub fn can_see_financial_data(&self) -> bool {
        match self {
            Role::Ceo => true,
            Role::CeoAssistant => true,
            Role::PatientManager => true,
            Role::TeamleadInterpreter => false,
            Role::Interpreter => false,
            Role::Concierge => false,
            Role::Billing => true,
            Role::Sales => false,
            Role::ItAdmin => true,
            Role::Patient => false,
        }
    }

    pub fn can_assign_patients(&self) -> bool {
        match self {
            Role::Ceo => true,
            Role::CeoAssistant => false,
            Role::PatientManager => false,
            Role::TeamleadInterpreter => false,
            Role::Interpreter => false,
            Role::Concierge => false,
            Role::Billing => false,
            Role::Sales => false,
            Role::ItAdmin => true,
            Role::Patient => false,
        }
    }

    pub fn display_name(&self) -> &'static str {
        match self {
            Role::Ceo => "CEO",
            Role::CeoAssistant => "CEO-Assistent",
            Role::PatientManager => "Patientenmanager",
            Role::TeamleadInterpreter => "Teamlead Dolmetscher",
            Role::Interpreter => "Dolmetscher",
            Role::Concierge => "Concierge",
            Role::Billing => "Abrechnung",
            Role::Sales => "Vertrieb",
            Role::ItAdmin => "IT-Admin",
            Role::Patient => "Patient",
        }
    }
}

impl std::fmt::Display for Role {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.display_name())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ceo_and_it_admin_have_full_access() {
        assert!(Role::Ceo.has_full_access());
        assert!(Role::ItAdmin.has_full_access());
        assert!(!Role::CeoAssistant.has_full_access());
        assert!(!Role::PatientManager.has_full_access());
        assert!(!Role::Sales.has_full_access());
        assert!(!Role::Patient.has_full_access());
    }

    #[test]
    fn medical_data_visibility() {
        // Clinical roles can see medical data
        assert!(Role::Ceo.can_see_medical_data());
        assert!(Role::CeoAssistant.can_see_medical_data());
        assert!(Role::PatientManager.can_see_medical_data());
        assert!(Role::TeamleadInterpreter.can_see_medical_data());
        assert!(Role::Interpreter.can_see_medical_data());
        // Non-clinical roles cannot, except IT admin as a full-access admin role.
        assert!(!Role::Concierge.can_see_medical_data());
        assert!(!Role::Billing.can_see_medical_data());
        assert!(!Role::Sales.can_see_medical_data());
        assert!(Role::ItAdmin.can_see_medical_data());
        assert!(!Role::Patient.can_see_medical_data());
    }

    #[test]
    fn financial_data_visibility() {
        assert!(Role::Ceo.can_see_financial_data());
        assert!(Role::Billing.can_see_financial_data());
        assert!(Role::PatientManager.can_see_financial_data());
        assert!(Role::ItAdmin.can_see_financial_data());
        assert!(!Role::Sales.can_see_financial_data());
        assert!(!Role::Interpreter.can_see_financial_data());
        assert!(!Role::Patient.can_see_financial_data());
    }

    #[test]
    fn full_admins_can_assign_patients() {
        assert!(Role::Ceo.can_assign_patients());
        assert!(Role::ItAdmin.can_assign_patients());
        assert!(!Role::PatientManager.can_assign_patients());
        assert!(!Role::Sales.can_assign_patients());
    }

    #[test]
    fn display_names_are_nonempty() {
        let roles = [
            Role::Ceo,
            Role::CeoAssistant,
            Role::PatientManager,
            Role::TeamleadInterpreter,
            Role::Interpreter,
            Role::Concierge,
            Role::Billing,
            Role::Sales,
            Role::ItAdmin,
            Role::Patient,
        ];
        for role in roles {
            assert!(
                !role.display_name().is_empty(),
                "{:?} has empty display name",
                role
            );
            assert!(!format!("{role}").is_empty());
        }
    }

    #[test]
    fn serde_roundtrip() {
        let role = Role::PatientManager;
        let json = serde_json::to_string(&role).unwrap();
        assert_eq!(json, "\"patient_manager\"");
        let back: Role = serde_json::from_str(&json).unwrap();
        assert_eq!(back, role);
    }

    #[test]
    fn serde_all_roles() {
        let cases = [
            (Role::Ceo, "\"ceo\""),
            (Role::Sales, "\"sales\""),
            (Role::Billing, "\"billing\""),
            (Role::Interpreter, "\"interpreter\""),
            (Role::Patient, "\"patient\""),
        ];
        for (role, expected) in cases {
            assert_eq!(serde_json::to_string(&role).unwrap(), expected);
        }
    }

    #[test]
    fn rbac_capability_matrix_matches_product_matrix() {
        let all = [
            Role::Ceo,
            Role::CeoAssistant,
            Role::PatientManager,
            Role::TeamleadInterpreter,
            Role::Interpreter,
            Role::Concierge,
            Role::Billing,
            Role::Sales,
            Role::ItAdmin,
            Role::Patient,
        ];

        for role in all {
            let medical = role.can_see_medical_data();
            let financial = role.can_see_financial_data();
            let full = role.has_full_access();
            let assign = role.can_assign_patients();

            assert_eq!(full, matches!(role, Role::Ceo | Role::ItAdmin));
            assert_eq!(assign, matches!(role, Role::Ceo | Role::ItAdmin));

            match role {
                Role::Concierge | Role::Billing | Role::Sales => {
                    assert!(!medical, "{role:?} must not see medical per matrix");
                }
                Role::Patient => assert!(!medical),
                Role::Ceo
                | Role::ItAdmin
                | Role::CeoAssistant
                | Role::PatientManager
                | Role::TeamleadInterpreter
                | Role::Interpreter => assert!(medical),
            }

            match role {
                Role::Ceo
                | Role::ItAdmin
                | Role::CeoAssistant
                | Role::PatientManager
                | Role::Billing => {
                    assert!(financial, "{role:?} expects financial visibility");
                }
                _ => assert!(
                    !financial,
                    "{role:?} must not have financial visibility flag"
                ),
            }
        }
    }
}
