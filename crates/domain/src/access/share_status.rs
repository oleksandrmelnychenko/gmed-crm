use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[non_exhaustive]
pub enum ShareStatus {
    InternalOnly,
    ReleasedInternal,
    ReleasedExternal,
    PatientVisible,
}

impl ShareStatus {
    pub fn can_share_externally(&self) -> bool {
        match self {
            Self::InternalOnly => false,
            Self::ReleasedInternal => false,
            Self::ReleasedExternal => true,
            Self::PatientVisible => true,
        }
    }

    pub fn is_patient_visible(&self) -> bool {
        match self {
            Self::InternalOnly => false,
            Self::ReleasedInternal => false,
            Self::ReleasedExternal => false,
            Self::PatientVisible => true,
        }
    }

    pub fn display_name(&self) -> &'static str {
        match self {
            Self::InternalOnly => "Internal Only",
            Self::ReleasedInternal => "Released (Internal)",
            Self::ReleasedExternal => "Released (External)",
            Self::PatientVisible => "Patient Visible",
        }
    }
}
