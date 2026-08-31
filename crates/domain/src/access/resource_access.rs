use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::role::Role;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResourceType {
    Provider,
    Patient,
    Document,
}

impl ResourceType {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Provider => "provider",
            Self::Patient => "patient",
            Self::Document => "document",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AccessCapability {
    View,
    Use,
    Edit,
    Upload,
    Download,
}

impl AccessCapability {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::View => "view",
            Self::Use => "use",
            Self::Edit => "edit",
            Self::Upload => "upload",
            Self::Download => "download",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AccessEffect {
    Allow,
    Deny,
}

impl AccessEffect {
    pub fn from_db(value: &str) -> Option<Self> {
        match value {
            "allow" => Some(Self::Allow),
            "deny" => Some(Self::Deny),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ResourceAccessRequest {
    pub resource_type: ResourceType,
    pub resource_id: Uuid,
    pub capability: AccessCapability,
    /// Medical sensitivity belongs to the record/content, not to the provider
    /// organisation type. A medical provider directory entry therefore passes
    /// `false`; a medical document passes `true`.
    pub is_medical: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AccessRuleSource {
    Ceo,
    UserRule,
    ProfileRule,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResourceAccessDecision {
    Allow(AccessRuleSource),
    DenySystemBoundary,
    Deny(AccessRuleSource),
    NoExplicitRule,
}

impl ResourceAccessDecision {
    pub const fn explicit_allow(self) -> bool {
        matches!(self, Self::Allow(_))
    }

    pub const fn explicit_result(self) -> Option<bool> {
        match self {
            Self::Allow(_) => Some(true),
            Self::DenySystemBoundary | Self::Deny(_) => Some(false),
            Self::NoExplicitRule => None,
        }
    }
}

/// Absolute boundaries are evaluated before database grants. The resolver only
/// supplies an explicit override; existing role, assignment, and field policy
/// checks continue to apply when no rule exists.
pub fn passes_absolute_resource_boundary(role: Role, request: &ResourceAccessRequest) -> bool {
    if role == Role::Ceo {
        return true;
    }

    if role == Role::Patient {
        return false;
    }

    // Provider directory metadata is not clinical content. Patient fields are
    // still filtered separately by field_access_policies. Medical documents,
    // however, remain unavailable to roles without medical-data visibility.
    !(request.resource_type == ResourceType::Document
        && request.is_medical
        && !role.can_see_medical_data())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(resource_type: ResourceType, is_medical: bool) -> ResourceAccessRequest {
        ResourceAccessRequest {
            resource_type,
            resource_id: Uuid::new_v4(),
            capability: AccessCapability::View,
            is_medical,
        }
    }

    #[test]
    fn medical_provider_metadata_is_not_treated_as_medical_content() {
        assert!(passes_absolute_resource_boundary(
            Role::Concierge,
            &request(ResourceType::Provider, false),
        ));
    }

    #[test]
    fn medical_documents_remain_blocked_for_non_medical_roles() {
        assert!(!passes_absolute_resource_boundary(
            Role::Concierge,
            &request(ResourceType::Document, true),
        ));
        assert!(!passes_absolute_resource_boundary(
            Role::Billing,
            &request(ResourceType::Document, true),
        ));
    }

    #[test]
    fn ceo_keeps_full_access_and_patient_accounts_cannot_receive_staff_grants() {
        let medical_document = request(ResourceType::Document, true);
        assert!(passes_absolute_resource_boundary(
            Role::Ceo,
            &medical_document,
        ));
        assert!(!passes_absolute_resource_boundary(
            Role::Patient,
            &request(ResourceType::Provider, false),
        ));
    }
}
