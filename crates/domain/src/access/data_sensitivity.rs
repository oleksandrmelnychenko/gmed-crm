use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[non_exhaustive]
pub enum DataSensitivity {
    General,
    PatientIdentity,
    Medical,
    Financial,
    Internal,
    Service,
}

impl DataSensitivity {
    pub fn display_name(&self) -> &'static str {
        match self {
            Self::General => "General",
            Self::PatientIdentity => "Patient Identity",
            Self::Medical => "Medical",
            Self::Financial => "Financial",
            Self::Internal => "Internal",
            Self::Service => "Service",
        }
    }
}
